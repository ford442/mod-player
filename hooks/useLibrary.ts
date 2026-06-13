import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRemoteSongs, fetchShaders, saveSong, syncLibrary } from '../utils/storageApi';
import type { RemoteSong, SongSaveRequest } from '../utils/storageApi';

export const libraryQueryKeys = {
  songs: ['library', 'songs'] as const,
  shaders: ['library', 'shaders'] as const,
};

export function useLibrary() {
  const songsQuery = useQuery({
    queryKey: libraryQueryKeys.songs,
    queryFn: fetchRemoteSongs,
    staleTime: 60_000,
    retry: false,
  });

  const shadersQuery = useQuery({
    queryKey: libraryQueryKeys.shaders,
    queryFn: fetchShaders,
    staleTime: 60_000,
    retry: false,
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
