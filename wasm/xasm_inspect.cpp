/*
 * wasm/xasm_inspect.cpp – read a module's internals from the C++ object libopenmpt already parsed
 *
 * Linked into the SHARED pair only (public/worklets/libopenmpt-worklet.{js,wasm}: main thread and
 * parser worker), never into libopenmpt-playback: the audio thread needs none of it (pitfall 4,
 * #513). scripts/build-js-libopenmpt.sh copies this file into the libopenmpt build tree as
 * libopenmpt/xasm_inspect.cpp and compiles it with libopenmpt's own make rule, so it gets exactly
 * libopenmpt's CXXFLAGS / CPPFLAGS (wasm EH, -Os, ThinLTO, -fvisibility=hidden, -DLIBOPENMPT_BUILD).
 *
 * Access without patching the tarball: openmpt::module_impl::m_sndFile is `protected`, so a member
 * pointer formed inside a derived class is standard-conforming. The shim constructs its own
 * module_impl from the bytes; it never depends on the layout of the C API's private
 * `struct openmpt_module`.
 *
 * Every entry point catches every exception (same wasm-EH model as libopenmpt's C API): a bad file
 * or an out-of-range index is a 0 / -1 return, never an abort of the shared runtime.
 *
 * The CSoundFile / ModSample / ModInstrument fields read here are internal to libopenmpt 0.8.9 (the
 * pin in scripts/lib/libopenmpt-source.sh); public/worklets/README.md lists them. A libopenmpt bump
 * that changes them must bump XASM_INSPECT_ABI_VERSION, which the TypeScript wrapper
 * (utils/moduleInspect.ts) and scripts/verify-js-libopenmpt.mjs both check.
 *
 * Layouts (all little-endian, all fields int32 unless noted) are mirrored in utils/moduleInspect.ts.
 */

#include "common/stdafx.h"

#include "libopenmpt_internal.h"
#include "libopenmpt.hpp"
#include "libopenmpt_impl.hpp"

#include "soundlib/Sndfile.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace {

/** Bump on ANY change to a signature, a struct layout or a flag bit below. */
constexpr std::int32_t XASM_INSPECT_ABI_VERSION = 1;

constexpr std::uint32_t XASM_CREATE_SKIP_SAMPLES = 1u << 0;
constexpr std::uint32_t XASM_TIMELINE_EVERY_TICK = 1u << 0;

constexpr int XASM_MODULE_INFO_FIELDS = 6;
constexpr int XASM_SAMPLE_INFO_FIELDS = 16;
constexpr int XASM_INSTRUMENT_INFO_FIELDS = 14;
constexpr int XASM_ENVELOPE_HEADER_FIELDS = 7;
constexpr int XASM_KEYMAP_NOTES = 128;
constexpr int XASM_CELL_BYTES = 6;
constexpr int XASM_TIMELINE_VISIT_FIELDS = 4;
constexpr int XASM_TIMELINE_TEMPO_FIELDS = 5;
constexpr int XASM_TIMELINE_SUMMARY_FIELDS = 5;

// The walk's safety caps: a tick budget (~44 h of music at speed 6 / 125 BPM) and event caps, so a
// pathological module (huge pattern loops, F00 rows) ends with endReason = capped, not a hang.
constexpr std::uint64_t XASM_TIMELINE_MAX_TICKS = 8u * 1024u * 1024u;
constexpr std::size_t XASM_TIMELINE_MAX_VISITS = 1u << 20;
constexpr std::size_t XASM_TIMELINE_MAX_TEMPO = 1u << 16;

class null_log : public openmpt::log_interface {
public:
	void log( const std::string & ) const override { }
};

struct sndfile_access : openmpt::module_impl {
	static OpenMPT::CSoundFile & of( openmpt::module_impl & m ) {
		return *( m.*( &sndfile_access::m_sndFile ) );
	}
};

struct timeline_visit {
	double start_seconds;
	std::int32_t order;
	std::int32_t entry_row;
	std::int32_t exit_row;
};

struct timeline_tempo {
	double seconds;
	double tempo;
	std::int32_t order;
	std::int32_t row;
	std::int32_t speed;
};

struct inspect_handle {
	std::unique_ptr<openmpt::module_impl> impl;
	OpenMPT::CSoundFile * snd = nullptr;
	std::vector<timeline_visit> visits;
	std::vector<timeline_tempo> tempo;
	double timeline_seconds = 0.0;
	std::int32_t timeline_end_order = -1;
	std::int32_t timeline_end_row = -1;
	std::int32_t timeline_end_reason = 0;  // 0 song ended / looped, 1 capped
	double timeline_ticks = 0.0;
};

inspect_handle * as_handle( std::uintptr_t h ) {
	return reinterpret_cast<inspect_handle *>( h );
}

const OpenMPT::ModSample * sample_at( inspect_handle * h, std::int32_t index ) {
	if ( !h || index < 1 || index > static_cast<std::int32_t>( h->snd->GetNumSamples() ) ) {
		return nullptr;
	}
	return &h->snd->GetSample( static_cast<OpenMPT::SAMPLEINDEX>( index ) );
}

const OpenMPT::ModInstrument * instrument_at( inspect_handle * h, std::int32_t index ) {
	if ( !h || index < 1 || index > static_cast<std::int32_t>( h->snd->GetNumInstruments() ) ) {
		return nullptr;
	}
	return h->snd->Instruments[index];
}

bool sample_has_pcm( const OpenMPT::ModSample & s ) {
	return s.HasSampleData() && !s.uFlags[OpenMPT::CHN_ADLIB];
}

/** One PCM value of `frame`, channel `ch`, normalised to [-1, 1). */
float pcm_value( const OpenMPT::ModSample & s, std::size_t frame, unsigned ch ) {
	const std::size_t i = frame * s.GetNumChannels() + ch;
	if ( s.GetElementarySampleSize() == 2 ) {
		return static_cast<float>( s.sample16()[i] ) * ( 1.0f / 32768.0f );
	}
	return static_cast<float>( s.sample8()[i] ) * ( 1.0f / 128.0f );
}

/** Whether the row being played has a CMD_TEMPO (set or slide) in any channel. */
bool row_sets_tempo( const OpenMPT::CSoundFile & sf, const OpenMPT::PlayState & ps ) {
	if ( !sf.Patterns.IsValidPat( ps.m_nPattern ) ) {
		return false;
	}
	const OpenMPT::CPattern & pattern = sf.Patterns[ps.m_nPattern];
	if ( ps.m_nRow >= pattern.GetNumRows() ) {
		return false;
	}
	const OpenMPT::ModCommand * m = pattern.GetpModCommand( ps.m_nRow, 0 );
	for ( OpenMPT::CHANNELINDEX c = 0; c < sf.GetNumChannels(); ++c, ++m ) {
		if ( m->command == OpenMPT::CMD_TEMPO ) {
			return true;
		}
	}
	return false;
}

} // namespace

// Exported by name through -sEXPORTED_FUNCTIONS (scripts/build-js-libopenmpt.sh). libopenmpt builds
// with -fvisibility=hidden; default visibility keeps the entry points through ThinLTO's
// internalisation the way LIBOPENMPT_API does for the openmpt_* C API.
#define XASM_API __attribute__( ( visibility( "default" ) ) )

extern "C" {

XASM_API std::int32_t xasm_inspect_abi_version( void ) {
	return XASM_INSPECT_ABI_VERSION;
}

/**
 * Parse `len` bytes into an inspection handle (0 when libopenmpt rejects the file or memory runs
 * out). The bytes are copied by libopenmpt; the caller may free them as soon as this returns.
 * `flags` bit 0 skips sample data (structure / timeline only).
 */
XASM_API std::uintptr_t xasm_inspect_create( const void * data, std::size_t len, std::uint32_t flags ) {
	if ( !data || len == 0 ) {
		return 0;
	}
	try {
		std::map<std::string, std::string> ctls;
		// Subsong durations are computed lazily (xasm_song_timeline selects a subsong); the parse
		// path never needs them.
		ctls["load.skip_subsongs_init"] = "1";
		if ( flags & XASM_CREATE_SKIP_SAMPLES ) {
			ctls["load.skip_samples"] = "1";
		}
		auto h = std::make_unique<inspect_handle>();
		h->impl = std::make_unique<openmpt::module_impl>( data, len, std::make_unique<null_log>(), ctls );
		h->snd = &sndfile_access::of( *h->impl );
		return reinterpret_cast<std::uintptr_t>( h.release() );
	} catch ( ... ) {
		return 0;
	}
}

XASM_API void xasm_inspect_destroy( std::uintptr_t handle ) {
	try {
		delete as_handle( handle );
	} catch ( ... ) {
	}
}

/** [channels, patterns, samples, instruments, sequences, orders of sequence 0]. Returns fields written. */
XASM_API std::int32_t xasm_module_info( std::uintptr_t handle, std::int32_t * out ) {
	inspect_handle * h = as_handle( handle );
	if ( !h || !out ) {
		return 0;
	}
	try {
		const OpenMPT::CSoundFile & sf = *h->snd;
		out[0] = sf.GetNumChannels();
		out[1] = static_cast<std::int32_t>( sf.Patterns.Size() );
		out[2] = sf.GetNumSamples();
		out[3] = sf.GetNumInstruments();
		out[4] = sf.Order.GetNumSequences();
		out[5] = sf.Order.GetNumSequences() > 0 ? static_cast<std::int32_t>( sf.Order( 0 ).size() ) : 0;
		return XASM_MODULE_INFO_FIELDS;
	} catch ( ... ) {
		return 0;
	}
}

/** Rows of pattern `pat`, 0 when it does not exist. */
XASM_API std::int32_t xasm_pattern_num_rows( std::uintptr_t handle, std::int32_t pat ) {
	inspect_handle * h = as_handle( handle );
	if ( !h || pat < 0 || pat > std::numeric_limits<OpenMPT::PATTERNINDEX>::max() ) {
		return 0;
	}
	try {
		const auto p = static_cast<OpenMPT::PATTERNINDEX>( pat );
		return h->snd->Patterns.IsValidPat( p ) ? static_cast<std::int32_t>( h->snd->Patterns[p].GetNumRows() ) : 0;
	} catch ( ... ) {
		return 0;
	}
}

/**
 * Every cell of pattern `pat`, row-major, XASM_CELL_BYTES each in libopenmpt's PatternCommand order
 * (note, instrument, volume command, effect command, volume parameter, effect parameter — the values
 * openmpt_module_get_pattern_row_channel_command returns, utils/openmptCommands.ts). Returns the
 * rows written, 0 for a missing pattern, -1 when `max_bytes` is too small.
 */
XASM_API std::int32_t xasm_pattern_dump( std::uintptr_t handle, std::int32_t pat, std::uint8_t * out, std::int32_t max_bytes ) {
	inspect_handle * h = as_handle( handle );
	if ( !h || !out || pat < 0 || pat > std::numeric_limits<OpenMPT::PATTERNINDEX>::max() ) {
		return 0;
	}
	try {
		const OpenMPT::CSoundFile & sf = *h->snd;
		const auto p = static_cast<OpenMPT::PATTERNINDEX>( pat );
		if ( !sf.Patterns.IsValidPat( p ) ) {
			return 0;
		}
		const OpenMPT::CPattern & pattern = sf.Patterns[p];
		const std::int64_t rows = pattern.GetNumRows();
		const std::int64_t channels = sf.GetNumChannels();
		if ( rows * channels * XASM_CELL_BYTES > max_bytes ) {
			return -1;
		}
		std::uint8_t * o = out;
		for ( OpenMPT::ROWINDEX r = 0; r < pattern.GetNumRows(); ++r ) {
			const OpenMPT::ModCommand * m = pattern.GetpModCommand( r, 0 );
			for ( OpenMPT::CHANNELINDEX c = 0; c < sf.GetNumChannels(); ++c, ++m ) {
				o[0] = static_cast<std::uint8_t>( m->note );
				o[1] = static_cast<std::uint8_t>( m->instr );
				o[2] = static_cast<std::uint8_t>( m->volcmd );
				o[3] = static_cast<std::uint8_t>( m->command );
				o[4] = static_cast<std::uint8_t>( m->vol );
				o[5] = static_cast<std::uint8_t>( m->param );
				o += XASM_CELL_BYTES;
			}
		}
		return static_cast<std::int32_t>( rows );
	} catch ( ... ) {
		return 0;
	}
}

XASM_API std::int32_t xasm_sample_count( std::uintptr_t handle ) {
	inspect_handle * h = as_handle( handle );
	return h ? h->snd->GetNumSamples() : 0;
}

/**
 * Sample `index` (1-based): [length, loopStart, loopEnd, sustainStart, sustainEnd (frames), flags,
 * sampleRate (Hz at middle C, as played), volume (0..256), pan (0..256), globalVolume (0..64),
 * relativeTone, finetune, vibratoType, vibratoSweep, vibratoDepth, vibratoRate].
 * flags: 1 16-bit, 2 stereo, 4 loop, 8 ping-pong loop, 16 sustain loop, 32 ping-pong sustain,
 * 64 forced panning, 128 OPL (AdLib), 256 has PCM, 512 ignores its default volume.
 * Returns 1, or 0 for a bad index.
 */
XASM_API std::int32_t xasm_sample_info( std::uintptr_t handle, std::int32_t index, std::int32_t * out ) {
	inspect_handle * h = as_handle( handle );
	const OpenMPT::ModSample * s = sample_at( h, index );
	if ( !s || !out ) {
		return 0;
	}
	try {
		std::int32_t flags = 0;
		if ( s->uFlags[OpenMPT::CHN_16BIT] ) flags |= 1;
		if ( s->uFlags[OpenMPT::CHN_STEREO] ) flags |= 2;
		if ( s->uFlags[OpenMPT::CHN_LOOP] ) flags |= 4;
		if ( s->uFlags[OpenMPT::CHN_PINGPONGLOOP] ) flags |= 8;
		if ( s->uFlags[OpenMPT::CHN_SUSTAINLOOP] ) flags |= 16;
		if ( s->uFlags[OpenMPT::CHN_PINGPONGSUSTAIN] ) flags |= 32;
		if ( s->uFlags[OpenMPT::CHN_PANNING] ) flags |= 64;
		if ( s->uFlags[OpenMPT::CHN_ADLIB] ) flags |= 128;
		if ( sample_has_pcm( *s ) ) flags |= 256;
		if ( s->uFlags[OpenMPT::SMP_NODEFAULTVOLUME] ) flags |= 512;
		out[0] = static_cast<std::int32_t>( s->nLength );
		out[1] = static_cast<std::int32_t>( s->nLoopStart );
		out[2] = static_cast<std::int32_t>( s->nLoopEnd );
		out[3] = static_cast<std::int32_t>( s->nSustainStart );
		out[4] = static_cast<std::int32_t>( s->nSustainEnd );
		out[5] = flags;
		out[6] = static_cast<std::int32_t>( s->GetSampleRate( h->snd->GetType() ) );
		out[7] = s->nVolume;
		out[8] = s->nPan;
		out[9] = s->nGlobalVol;
		out[10] = s->RelativeTone;
		out[11] = s->nFineTune;
		out[12] = static_cast<std::int32_t>( s->nVibType );
		out[13] = s->nVibSweep;
		out[14] = s->nVibDepth;
		out[15] = s->nVibRate;
		return 1;
	} catch ( ... ) {
		return 0;
	}
}

/**
 * Min/max waveform peaks of sample `index`, downsampled here so a long sample never crosses into JS
 * to draw a thumbnail: `buckets` pairs (min, max) in [-1, 1], both channels of a stereo sample
 * folded together. Returns the buckets written (0: no PCM or bad index).
 */
XASM_API std::int32_t xasm_sample_pcm_peaks( std::uintptr_t handle, std::int32_t index, std::int32_t buckets, float * out ) {
	inspect_handle * h = as_handle( handle );
	const OpenMPT::ModSample * s = sample_at( h, index );
	if ( !s || !out || buckets <= 0 || !sample_has_pcm( *s ) ) {
		return 0;
	}
	try {
		const std::size_t frames = s->nLength;
		const unsigned channels = s->GetNumChannels();
		for ( std::int32_t b = 0; b < buckets; ++b ) {
			std::size_t start = static_cast<std::size_t>( ( static_cast<std::uint64_t>( b ) * frames ) / static_cast<std::uint64_t>( buckets ) );
			std::size_t end = static_cast<std::size_t>( ( static_cast<std::uint64_t>( b + 1 ) * frames ) / static_cast<std::uint64_t>( buckets ) );
			if ( end <= start ) end = std::min( start + 1, frames );
			float lo = 0.0f;
			float hi = 0.0f;
			for ( std::size_t f = start; f < end; ++f ) {
				for ( unsigned ch = 0; ch < channels; ++ch ) {
					const float v = pcm_value( *s, f, ch );
					lo = std::min( lo, v );
					hi = std::max( hi, v );
				}
			}
			out[2 * b] = lo;
			out[2 * b + 1] = hi;
		}
		return buckets;
	} catch ( ... ) {
		return 0;
	}
}

/**
 * Full PCM of sample `index` as floats in [-1, 1), interleaved when stereo (opt-in: the #514
 * studio). Writes min(length × channels, max_values). Returns the values written.
 */
XASM_API std::int32_t xasm_sample_pcm( std::uintptr_t handle, std::int32_t index, float * out, std::int32_t max_values ) {
	inspect_handle * h = as_handle( handle );
	const OpenMPT::ModSample * s = sample_at( h, index );
	if ( !s || !out || max_values <= 0 || !sample_has_pcm( *s ) ) {
		return 0;
	}
	try {
		const unsigned channels = s->GetNumChannels();
		const std::uint64_t total = static_cast<std::uint64_t>( s->nLength ) * channels;
		const std::uint64_t n = std::min<std::uint64_t>( total, static_cast<std::uint64_t>( max_values ) );
		for ( std::uint64_t i = 0; i < n; ++i ) {
			out[i] = pcm_value( *s, static_cast<std::size_t>( i / channels ), static_cast<unsigned>( i % channels ) );
		}
		return static_cast<std::int32_t>( n );
	} catch ( ... ) {
		return 0;
	}
}

XASM_API std::int32_t xasm_instrument_count( std::uintptr_t handle ) {
	inspect_handle * h = as_handle( handle );
	return h ? h->snd->GetNumInstruments() : 0;
}

/**
 * Instrument `index` (1-based): [exists, fadeOut, globalVolume (0..64), pan (0..256), flags
 * (1 pan set, 2 mute), newNoteAction, duplicateCheck, duplicateAction, panSwing, volSwing,
 * cutoff (bit 7 = enabled), resonance (bit 7 = enabled), pitchPanSeparation, pitchPanCenter].
 * Returns 1, or 0 for a bad index (an index inside the count with no instrument writes exists = 0).
 */
XASM_API std::int32_t xasm_instrument_info( std::uintptr_t handle, std::int32_t index, std::int32_t * out ) {
	inspect_handle * h = as_handle( handle );
	if ( !h || !out || index < 1 || index > static_cast<std::int32_t>( h->snd->GetNumInstruments() ) ) {
		return 0;
	}
	try {
		std::fill( out, out + XASM_INSTRUMENT_INFO_FIELDS, 0 );
		const OpenMPT::ModInstrument * ins = instrument_at( h, index );
		if ( !ins ) {
			return 1;
		}
		std::int32_t flags = 0;
		if ( ins->dwFlags[OpenMPT::INS_SETPANNING] ) flags |= 1;
		if ( ins->dwFlags[OpenMPT::INS_MUTE] ) flags |= 2;
		out[0] = 1;
		out[1] = static_cast<std::int32_t>( ins->nFadeOut );
		out[2] = static_cast<std::int32_t>( ins->nGlobalVol );
		out[3] = static_cast<std::int32_t>( ins->nPan );
		out[4] = flags;
		out[5] = static_cast<std::int32_t>( ins->nNNA );
		out[6] = static_cast<std::int32_t>( ins->nDCT );
		out[7] = static_cast<std::int32_t>( ins->nDNA );
		out[8] = ins->nPanSwing;
		out[9] = ins->nVolSwing;
		out[10] = ins->nIFC;
		out[11] = ins->nIFR;
		out[12] = ins->nPPS;
		out[13] = ins->nPPC;
		return 1;
	} catch ( ... ) {
		return 0;
	}
}

/**
 * Envelope `kind` (0 volume, 1 panning, 2 pitch / filter) of instrument `index`:
 * header [flags, points, loopStart, loopEnd, sustainStart, sustainEnd, releaseNode] (node indices;
 * releaseNode 255 = unset), then `points` (tick, value) pairs, value 0..64.
 * flags: 1 enabled, 2 loop, 4 sustain, 8 carry, 16 filter (pitch envelope drives the filter).
 * Writes at most `max_points` pairs. Returns the points in the envelope (may exceed max_points),
 * or -1 for a bad instrument / kind.
 */
XASM_API std::int32_t xasm_instrument_envelope( std::uintptr_t handle, std::int32_t index, std::int32_t kind, std::int32_t * out, std::int32_t max_points ) {
	inspect_handle * h = as_handle( handle );
	const OpenMPT::ModInstrument * ins = instrument_at( h, index );
	if ( !ins || !out || kind < 0 || kind > 2 || max_points < 0 ) {
		return -1;
	}
	try {
		const OpenMPT::EnvelopeType type = kind == 0 ? OpenMPT::ENV_VOLUME : ( kind == 1 ? OpenMPT::ENV_PANNING : OpenMPT::ENV_PITCH );
		const OpenMPT::InstrumentEnvelope & env = ins->GetEnvelope( type );
		std::int32_t flags = 0;
		if ( env.dwFlags[OpenMPT::ENV_ENABLED] ) flags |= 1;
		if ( env.dwFlags[OpenMPT::ENV_LOOP] ) flags |= 2;
		if ( env.dwFlags[OpenMPT::ENV_SUSTAIN] ) flags |= 4;
		if ( env.dwFlags[OpenMPT::ENV_CARRY] ) flags |= 8;
		if ( env.dwFlags[OpenMPT::ENV_FILTER] ) flags |= 16;
		const std::int32_t points = static_cast<std::int32_t>( env.size() );
		out[0] = flags;
		out[1] = points;
		out[2] = env.nLoopStart;
		out[3] = env.nLoopEnd;
		out[4] = env.nSustainStart;
		out[5] = env.nSustainEnd;
		out[6] = env.nReleaseNode;
		const std::int32_t n = std::min( points, max_points );
		for ( std::int32_t i = 0; i < n; ++i ) {
			out[XASM_ENVELOPE_HEADER_FIELDS + 2 * i] = env[i].tick;
			out[XASM_ENVELOPE_HEADER_FIELDS + 2 * i + 1] = env[i].value;
		}
		return points;
	} catch ( ... ) {
		return -1;
	}
}

/**
 * The note → sample keymap of instrument `index`: XASM_KEYMAP_NOTES sample indices (0 = none) for
 * notes 1..128, and, when `out_notes` is non-null, the note each one plays. Returns the notes
 * written, 0 for a bad index.
 */
XASM_API std::int32_t xasm_sample_map( std::uintptr_t handle, std::int32_t index, std::uint16_t * out, std::uint8_t * out_notes ) {
	inspect_handle * h = as_handle( handle );
	const OpenMPT::ModInstrument * ins = instrument_at( h, index );
	if ( !ins || !out ) {
		return 0;
	}
	try {
		for ( int i = 0; i < XASM_KEYMAP_NOTES; ++i ) {
			const OpenMPT::SAMPLEINDEX smp = ins->Keyboard[i];
			out[i] = smp <= h->snd->GetNumSamples() ? smp : 0;
			if ( out_notes ) out_notes[i] = ins->NoteMap[i];
		}
		return XASM_KEYMAP_NOTES;
	} catch ( ... ) {
		return 0;
	}
}

/**
 * ONE playback-state walk of subsong `subsong` on the player's own row/tick code
 * (CSoundFile::ProcessRow — effects, delays, pattern loops, jumps, exactly as playback), without
 * mixing a sample: the clock is the sum of CSoundFile::GetTickDuration over the ticks walked, the
 * same clock openmpt_module_set_position_order_row's GetLength walk keeps. It records every order
 * visit (order, entry row, exit row, start seconds) and every tempo / speed change at a row start,
 * and stops where playback would stop or loop (the walk never repeats). Linear in song length,
 * where one set_position_order_row per order is quadratic (#537).
 *
 * Speed: a row is priced as tick duration × ticks on the row (what GetLength does), so only its
 * first tick runs the effect code. Every tick of a row runs when that tick-by-tick state can move
 * the clock: the row sets or slides the tempo (CMD_TEMPO, incl. ProTracker's tempo-on-second-tick),
 * it is a row or tick delay (SEx / EEx / S6x: ticks on the row exceed the speed; delayed rows re-run
 * first-tick effects), or the module has global
 * instrument scripts. `flags` bit 0 (XASM_TIMELINE_EVERY_TICK) runs every tick of every row — the
 * reference the tests hold the fast walk to.
 *
 * The handle's play position is moved; inspection handles never play. Results stay on the handle
 * until the next walk: read them with xasm_timeline_*. Returns the visits recorded, or -1.
 */
XASM_API std::int32_t xasm_song_timeline( std::uintptr_t handle, std::int32_t subsong, std::uint32_t flags ) {
	inspect_handle * h = as_handle( handle );
	if ( !h ) {
		return -1;
	}
	try {
		h->visits.clear();
		h->tempo.clear();
		h->timeline_seconds = 0.0;
		h->timeline_end_order = -1;
		h->timeline_end_row = -1;
		h->timeline_end_reason = 0;
		h->timeline_ticks = 0.0;

		h->impl->select_subsong( std::max<std::int32_t>( 0, subsong ) );
		OpenMPT::CSoundFile & sf = *h->snd;
		sf.SetRepeatCount( 0 );
		OpenMPT::PlayState & ps = sf.m_PlayState;
		const double freq = static_cast<double>( sf.m_MixerSettings.gdwMixingFreq );
		const bool isXM = sf.GetType() == OpenMPT::MOD_TYPE_XM;
		const bool everyTick = ( flags & XASM_TIMELINE_EVERY_TICK ) != 0 || !sf.m_globalScript.empty();

		std::uint64_t samples = 0;
		std::uint64_t ticks = 0;
		std::int32_t lastSpeed = -1;
		double lastTempo = -1.0;
		bool capped = false;
		for ( ;; ) {
			if ( ticks >= XASM_TIMELINE_MAX_TICKS ) {
				capped = true;
				break;
			}
			if ( !sf.ProcessRow() ) {
				break;
			}
			if ( ps.m_nMusicTempo.GetRaw() == 0 ) {
				break;
			}
			// F00 in XM is "stop song" (GetLength treats it the same way).
			if ( isXM && ps.m_nMusicSpeed == OpenMPT::uint16_max ) {
				break;
			}
			if ( ps.m_nTickCount == 0 ) {
				const double t = static_cast<double>( samples ) / freq;
				const auto order = static_cast<std::int32_t>( ps.m_nCurrentOrder );
				const auto row = static_cast<std::int32_t>( ps.m_nRow );
				if ( h->visits.empty() || h->visits.back().order != order ) {
					if ( h->visits.size() >= XASM_TIMELINE_MAX_VISITS ) {
						capped = true;
						break;
					}
					h->visits.push_back( { t, order, row, row } );
				} else {
					h->visits.back().exit_row = row;
				}
				const auto speed = static_cast<std::int32_t>( ps.m_nMusicSpeed );
				const double tempo = ps.m_nMusicTempo.ToDouble();
				if ( ( speed != lastSpeed || tempo != lastTempo ) && h->tempo.size() < XASM_TIMELINE_MAX_TEMPO ) {
					h->tempo.push_back( { t, tempo, order, row, speed } );
					lastSpeed = speed;
					lastTempo = tempo;
				}
			}
			ps.m_globalScriptState.NextTick( ps, sf );
			const std::uint32_t tickDuration = sf.GetTickDuration( ps );
			const std::uint32_t rowTicks = ps.TicksOnRow();
			if ( ps.m_nTickCount == 0 && rowTicks > 1 && !everyTick
				&& rowTicks <= ps.m_nMusicSpeed && !row_sets_tempo( sf, ps ) ) {
				// Skip to the row's last tick: the next ProcessRow moves to the next row.
				ps.m_nTickCount = rowTicks - 1;
				samples += static_cast<std::uint64_t>( tickDuration ) * rowTicks;
				ticks += rowTicks;
			} else {
				samples += tickDuration;
				++ticks;
			}
		}
		h->timeline_seconds = static_cast<double>( samples ) / freq;
		h->timeline_end_order = static_cast<std::int32_t>( ps.m_nCurrentOrder );
		h->timeline_end_row = static_cast<std::int32_t>( ps.m_nRow );
		h->timeline_end_reason = capped ? 1 : 0;
		h->timeline_ticks = static_cast<double>( ticks );
		return static_cast<std::int32_t>( h->visits.size() );
	} catch ( ... ) {
		h->visits.clear();
		h->tempo.clear();
		return -1;
	}
}

/** Visits of the last walk: XASM_TIMELINE_VISIT_FIELDS doubles each (order, entryRow, exitRow, startSeconds). Returns visits written. */
XASM_API std::int32_t xasm_timeline_visits( std::uintptr_t handle, double * out, std::int32_t max_visits ) {
	inspect_handle * h = as_handle( handle );
	if ( !h || !out || max_visits <= 0 ) {
		return 0;
	}
	const std::int32_t n = std::min( static_cast<std::int32_t>( h->visits.size() ), max_visits );
	for ( std::int32_t i = 0; i < n; ++i ) {
		const timeline_visit & v = h->visits[i];
		out[XASM_TIMELINE_VISIT_FIELDS * i] = v.order;
		out[XASM_TIMELINE_VISIT_FIELDS * i + 1] = v.entry_row;
		out[XASM_TIMELINE_VISIT_FIELDS * i + 2] = v.exit_row;
		out[XASM_TIMELINE_VISIT_FIELDS * i + 3] = v.start_seconds;
	}
	return n;
}

/** Tempo events of the last walk: XASM_TIMELINE_TEMPO_FIELDS doubles each (seconds, order, row, tempo, speed). Returns events written; with max_events = 0, the count. */
XASM_API std::int32_t xasm_timeline_tempo( std::uintptr_t handle, double * out, std::int32_t max_events ) {
	inspect_handle * h = as_handle( handle );
	if ( !h ) {
		return 0;
	}
	if ( !out || max_events <= 0 ) {
		return static_cast<std::int32_t>( h->tempo.size() );
	}
	const std::int32_t n = std::min( static_cast<std::int32_t>( h->tempo.size() ), max_events );
	for ( std::int32_t i = 0; i < n; ++i ) {
		const timeline_tempo & e = h->tempo[i];
		out[XASM_TIMELINE_TEMPO_FIELDS * i] = e.seconds;
		out[XASM_TIMELINE_TEMPO_FIELDS * i + 1] = e.order;
		out[XASM_TIMELINE_TEMPO_FIELDS * i + 2] = e.row;
		out[XASM_TIMELINE_TEMPO_FIELDS * i + 3] = e.tempo;
		out[XASM_TIMELINE_TEMPO_FIELDS * i + 4] = e.speed;
	}
	return n;
}

/** Summary of the last walk: [seconds walked, end order, end row (where playback stops or loops back to), end reason (0 ended / looped, 1 capped), ticks]. */
XASM_API std::int32_t xasm_timeline_summary( std::uintptr_t handle, double * out ) {
	inspect_handle * h = as_handle( handle );
	if ( !h || !out ) {
		return 0;
	}
	out[0] = h->timeline_seconds;
	out[1] = h->timeline_end_order;
	out[2] = h->timeline_end_row;
	out[3] = h->timeline_end_reason;
	out[4] = h->timeline_ticks;
	return XASM_TIMELINE_SUMMARY_FIELDS;
}

} // extern "C"
