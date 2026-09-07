import { Panel } from './Panel';
import { Playlist } from './Playlist';
import { MediaPanel } from './MediaPanel';
import { LibraryBrowser } from './LibraryBrowser';
import { LibraryPanel } from './LibraryPanel';
import { IS_PUBLIC_MODE, LIGHT_THEMES } from '../appConfig';
import { usePlayerFeatures } from '../context/PlayerFeaturesContext';
import { usePlayerUiStore } from '../store/playerUiStore';

/** Playlist, media overlay panel, cloud library, and local library sections (chrome mode only). */
export function LibraryAndPlaylistSection() {
  const features = usePlayerFeatures();
  const { theme, showPlaylist, showLibraryBrowser, showLocalLibrary } = usePlayerUiStore();

  const isDarkMode = !LIGHT_THEMES.has(theme);
  const showDevSurface = !IS_PUBLIC_MODE;
  const {
    mediaItem,
    mediaVisible,
    mediaFades,
    setMediaVisible,
    onMediaRemove,
    moduleMediaFileName,
    moduleMediaHintText,
    handleRemoteMediaSelect,
    onMediaFadesChange,
    playlistItems,
    playlistCurrentIndex,
    playlistIsPlaying,
    playlistShuffle,
    playlistRepeat,
    onPlaylistSelect,
    onPlaylistRemove,
    onPlaylistClear,
    onPlaylistPrev,
    onPlaylistNext,
    onPlaylistShuffleToggle,
    onPlaylistRepeatCycle,
    onPlaylistFilesAdded,
    songsData,
    songsLoading,
    songsRefreshing,
    libraryErrorMessage,
    onRefreshLibrary,
    handleLibrarySongLoad,
    onSyncLibrary,
    syncPending,
    syncLibraryErrorMessage,
    activeModuleForSave,
    onSaveModule,
    savePending,
    saveSongErrorMessage,
    localLibraryRoots,
    localLibraryLoading,
    localLibraryImporting,
    localLibraryImportProgress,
    localLibraryImportError,
    localLibraryFsAccessSupported,
    activeLibraryEntryId,
    onLocalLibraryImportFolder,
    onLocalLibraryImportWebkit,
    onLocalLibraryRescanRoot,
    onLocalLibraryRemoveRoot,
    onLocalLibraryCancelImport,
    onLocalLibraryPlay,
  } = features;

  return (
    <>
      {/* Playlist */}
      {showPlaylist && (
        <div className="mt-4">
          <Panel variant="raised" title="Playlist">
            <Playlist
              items={playlistItems}
              currentIndex={playlistCurrentIndex}
              isPlaying={playlistIsPlaying}
              shuffle={playlistShuffle}
              repeat={playlistRepeat}
              onSelect={onPlaylistSelect}
              onRemove={onPlaylistRemove}
              onClear={onPlaylistClear}
              onPrev={onPlaylistPrev}
              onNext={onPlaylistNext}
              onShuffleToggle={onPlaylistShuffleToggle}
              onRepeatCycle={onPlaylistRepeatCycle}
              onFilesAdded={onPlaylistFilesAdded}
            />
          </Panel>
        </div>
      )}

      {showDevSurface && (
        <div className="mt-4">
          <Panel variant="raised" title="Media Overlay">
            <MediaPanel
              media={mediaItem ? [mediaItem] : []}
              activeMediaId={mediaVisible ? mediaItem?.id : undefined}
              onSelect={(id) => {
                if (id && mediaItem?.id === id) {
                  setMediaVisible(true);
                  return;
                }
                setMediaVisible(false);
              }}
              onRemove={onMediaRemove}
              moduleFileName={moduleMediaFileName}
              moduleHintText={moduleMediaHintText}
              onApplyDetected={handleRemoteMediaSelect}
              fades={mediaFades}
              onFadesChange={onMediaFadesChange}
            />
          </Panel>
        </div>
      )}

      {/* Cloud Library */}
      {showLibraryBrowser && (
        <Panel variant="raised" title="Cloud Library" className="mt-4">
          <LibraryBrowser
            songs={songsData ?? []}
            loading={songsLoading}
            refreshPending={songsRefreshing}
            error={libraryErrorMessage}
            isDarkMode={isDarkMode}
            onRefresh={onRefreshLibrary}
            onLoadSong={handleLibrarySongLoad}
            onSync={onSyncLibrary}
            syncPending={syncPending}
            syncError={syncLibraryErrorMessage}
            activeModule={activeModuleForSave}
            onSaveModule={onSaveModule}
            savePending={savePending}
            saveError={saveSongErrorMessage}
          />
        </Panel>
      )}

      {/* Local Collection */}
      {showLocalLibrary && (
        <Panel variant="raised" title="Library" className="mt-4">
          <LibraryPanel
            roots={localLibraryRoots}
            isLoading={localLibraryLoading}
            isImporting={localLibraryImporting}
            importProgress={localLibraryImportProgress}
            importError={localLibraryImportError}
            fsAccessSupported={localLibraryFsAccessSupported}
            isDarkMode={isDarkMode}
            activeEntryId={activeLibraryEntryId ?? null}
            onImportFolder={onLocalLibraryImportFolder}
            onImportWebkitFiles={onLocalLibraryImportWebkit}
            onRescanRoot={onLocalLibraryRescanRoot}
            onRemoveRoot={onLocalLibraryRemoveRoot}
            onCancelImport={onLocalLibraryCancelImport}
            onPlayEntry={onLocalLibraryPlay}
          />
        </Panel>
      )}
    </>
  );
}
