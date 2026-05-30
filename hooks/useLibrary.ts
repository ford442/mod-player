import { useQuery } from '@tanstack/react-query';
import { fetchRemoteSongs, fetchShaders } from '../utils/storageApi';

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
