import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRemoteSongs, fetchShaders, saveSong, syncLibrary } from '../utils/storageApi';
import type { SongSaveRequest } from '../utils/storageApi';

export const libraryQueryKeys = {
  songs: ['library', 'songs'] as const,
  shaders: ['library', 'shaders'] as const,
};

export function useLibrary() {
  const songsQuery = useQuery({
    queryKey: libraryQueryKeys.songs,
    queryFn: fetchRemoteSongs,
    staleTime: 60_000,
  });

  const shadersQuery = useQuery({
    queryKey: libraryQueryKeys.shaders,
    queryFn: fetchShaders,
    staleTime: 60_000,
  });

  return { songsQuery, shadersQuery };
}

export function useSaveSong() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: SongSaveRequest) => saveSong(req),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.songs });
    },
  });
}

export function useSyncLibrary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: syncLibrary,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.songs });
    },
  });
}
