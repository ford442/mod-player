import { useMutation, useQueryClient } from '@tanstack/react-query';
import { libraryQueryKeys } from './useLibrary';
import { rateShader } from '../utils/storageApi';
import type { ShaderMeta } from '../utils/storageApi';

interface RateShaderArgs {
  id: string;
  score: number;
}

export function useRateShader() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, score }: RateShaderArgs) => rateShader(id, score),
    onMutate: async ({ id, score }) => {
      await queryClient.cancelQueries({ queryKey: libraryQueryKeys.shaders });
      const previous = queryClient.getQueryData<ShaderMeta[]>(libraryQueryKeys.shaders);

      queryClient.setQueryData<ShaderMeta[]>(libraryQueryKeys.shaders, current => {
        if (!current) return current;
        return current.map(shader => {
          if (shader.id !== id) return shader;

          const existingVotes = shader.voteCount ?? 0;
          const existingAverage = shader.averageRating ?? 0;
          const nextVotes = shader.userRating === null ? existingVotes + 1 : Math.max(existingVotes, 1);
          const total = existingAverage * existingVotes;
          const nextAverage = shader.userRating === null
            ? (existingVotes > 0 ? (total + score) / nextVotes : score)
            : (existingVotes > 0 ? ((total - shader.userRating) + score) / nextVotes : score);

          return {
            ...shader,
            averageRating: Number.isFinite(nextAverage) ? nextAverage : shader.averageRating,
            voteCount: nextVotes,
            userRating: score,
          };
        });
      });

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(libraryQueryKeys.shaders, context.previous);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: libraryQueryKeys.shaders });
    },
  });
}
