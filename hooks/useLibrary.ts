import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRemoteSongs, fetchShaders, saveSong, syncLibrary } from '../utils/storageApi';
import type { RemoteSong, SongSaveRequest } from '../utils/storageApi';
import { IS_PUBLIC_MODE, IS_SHADER_DEBUG } from '../appConfig';

export const libraryQueryKeys = {
  songs: ['library', 'songs'] as const,
  shaders: ['library', 'shaders'] as const,
};

export function useLibrary() {
  // The cloud library browser and shader catalog picker are both hidden in
  // public mode (see components/LibraryAndPlaylistSection.tsx,
  // components/GlobalControlsBar.tsx) — skip the fetches nobody can see.
  const songsQuery = useQuery({
    queryKey: libraryQueryKeys.songs,
    queryFn: fetchRemoteSongs,
    staleTime: 60_000,
    retry: false,
    enabled: !IS_PUBLIC_MODE,
  });

  const shadersQuery = useQuery({
    queryKey: libraryQueryKeys.shaders,
    queryFn: fetchShaders,
    staleTime: 60_000,
    retry: false,
    enabled: !IS_PUBLIC_MODE || IS_SHADER_DEBUG,
  });

  return { songsQuery, shadersQuery };
}

export function useSaveSong() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: SongSaveRequest) => saveSong(req),
    onSuccess: (savedSong) => {
      queryClient.setQueryData<RemoteSong[]>(libraryQueryKeys.songs, current => {
        if (!current) return [savedSong];
        const withoutDuplicate = current.filter(song => song.id !== savedSong.id && song.downloadUrl !== savedSong.downloadUrl);
        return [savedSong, ...withoutDuplicate];
      });
      void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.songs });
    },
  });
}

export function useSyncLibrary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: syncLibrary,
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: libraryQueryKeys.songs, type: 'active' });
      void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.songs });
    },
  });
}
