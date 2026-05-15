import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../utils/cn';

interface ShaderOption {
  id: string;
  label: string;
  group: 'Square' | 'Circular' | 'Video';
}

interface ShaderSelectorPanelProps {
  shaderOptions: ShaderOption[];
  selectedShader: string;
  onSelectShader: (shaderId: string) => void;
  favorites: string[];
  recents: string[];
  thumbnails: Record<string, string>;
  onToggleFavorite: (shaderId: string) => void;
  isDarkMode: boolean;
}

const THUMBNAIL_SIZE = 96;
const KEY_COLUMNS = 4;
const PLACEHOLDER_THUMBNAIL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMBNAIL_SIZE}" height="${THUMBNAIL_SIZE}" viewBox="0 0 ${THUMBNAIL_SIZE} ${THUMBNAIL_SIZE}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0ea5e9"/><stop offset="100%" stop-color="#6366f1"/></linearGradient></defs><rect width="${THUMBNAIL_SIZE}" height="${THUMBNAIL_SIZE}" fill="#0a0a0a"/><circle cx="${THUMBNAIL_SIZE / 2}" cy="${THUMBNAIL_SIZE / 2}" r="${THUMBNAIL_SIZE / 3}" fill="url(#g)" opacity="0.7"/><text x="50%" y="52%" fill="#cbd5e1" font-family="monospace" font-size="10" text-anchor="middle">No Preview</text></svg>`,
)}`;

function getLabel(shaderOptions: ShaderOption[], shaderId: string) {
  return shaderOptions.find(option => option.id === shaderId)?.label ?? shaderId;
}

export function ShaderSelectorPanel({
  shaderOptions,
  selectedShader,
  onSelectShader,
  favorites,
  recents,
  thumbnails,
  onToggleFavorite,
  isDarkMode,
}: ShaderSelectorPanelProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const optionById = useMemo(() => new Map(shaderOptions.map(option => [option.id, option])), [shaderOptions]);
  const allShaderIds = useMemo(() => shaderOptions.map(option => option.id), [shaderOptions]);

  const favoriteShaders = useMemo(
    () => favorites.map(id => optionById.get(id)).filter((option): option is ShaderOption => Boolean(option)),
    [favorites, optionById],
  );

  const recentShaders = useMemo(
    () => recents.map(id => optionById.get(id)).filter((option): option is ShaderOption => Boolean(option)).slice(0, 5),
    [recents, optionById],
  );

  useEffect(() => {
    if (!open) return;
    const selectedIndex = allShaderIds.indexOf(selectedShader);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    dialogRef.current?.focus();
  }, [allShaderIds, open, selectedShader]);

  useEffect(() => {
    if (!open) return;
    const handleDocumentClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (!allShaderIds.length) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setActiveIndex(index => Math.min(index + 1, allShaderIds.length - 1));
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setActiveIndex(index => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => Math.min(index + KEY_COLUMNS, allShaderIds.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(index - KEY_COLUMNS, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex < 0 || activeIndex >= allShaderIds.length) return;
      const target = allShaderIds[activeIndex];
      if (target) {
        onSelectShader(target);
        setOpen(false);
      }
    }
  };

  const renderShaderCard = (option: ShaderOption, index: number) => {
    const isFavorite = favorites.includes(option.id);
    const isSelected = selectedShader === option.id;
    const isActive = activeIndex === index;
    const liveThumbnail = thumbnails[option.id];
    const staticThumbnail = `${import.meta.env.BASE_URL}shaders/thumbnails/${option.id}.png`;
    const thumbnailSrc = liveThumbnail ?? staticThumbnail;

    return (
      <div
        key={option.id}
        className={cn(
          'group relative rounded-lg border p-2 text-left transition-colors',
          isDarkMode ? 'border-gray-700 bg-gray-900/80 hover:bg-gray-800' : 'border-gray-300 bg-white hover:bg-gray-50',
          isSelected && (isDarkMode ? 'border-cyan-500 bg-cyan-950/30' : 'border-cyan-500 bg-cyan-50'),
          isActive && 'ring-2 ring-cyan-500',
        )}
      >
        <button
          type="button"
          onClick={() => {
            onSelectShader(option.id);
            setOpen(false);
          }}
          className="block w-full text-left"
          aria-label={`Select shader ${option.label}`}
        >
          <img
            src={thumbnailSrc}
            alt={`${option.label} preview`}
            width={THUMBNAIL_SIZE}
            height={THUMBNAIL_SIZE}
            className="h-24 w-24 rounded border border-black/30 bg-black object-cover"
            loading="lazy"
          onError={(event) => {
            if (event.currentTarget.src === PLACEHOLDER_THUMBNAIL) return;
            event.currentTarget.src = PLACEHOLDER_THUMBNAIL;
          }}
        />
          <div className="mt-1 text-[10px] text-gray-500">{option.group}</div>
          <div className="text-xs font-mono leading-tight">{option.label}</div>
        </button>
        <button
          type="button"
          aria-label={isFavorite ? `Remove ${option.label} from favorites` : `Add ${option.label} to favorites`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleFavorite(option.id);
          }}
          className={cn(
            'absolute right-2 top-2 rounded px-1 text-sm transition-colors',
            isFavorite ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400',
          )}
        >
          {isFavorite ? '★' : '☆'}
        </button>
      </div>
    );
  };

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className={cn(
          'rounded border px-3 py-1 text-xs font-mono',
          isDarkMode ? 'border-gray-600 bg-gray-800 text-white hover:bg-gray-700' : 'border-gray-300 bg-white text-black hover:bg-gray-50',
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Shader Gallery: {getLabel(shaderOptions, selectedShader)}
      </button>
      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label="Shader selector panel"
          tabIndex={0}
          onKeyDown={handlePanelKeyDown}
          className={cn(
            'absolute right-0 z-40 mt-2 w-[540px] max-w-[90vw] rounded-xl border p-3 shadow-2xl',
            isDarkMode ? 'border-gray-700 bg-black/95 text-white' : 'border-gray-300 bg-white text-black',
          )}
        >
          {recentShaders.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-[10px] font-bold uppercase text-gray-500">Recently used</div>
              <div className="flex flex-wrap gap-1">
                {recentShaders.map(option => (
                  <button
                    key={`recent-${option.id}`}
                    type="button"
                    onClick={() => {
                      onSelectShader(option.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'rounded border px-2 py-1 text-xs font-mono',
                      selectedShader === option.id
                        ? 'border-cyan-500 text-cyan-400'
                        : isDarkMode
                          ? 'border-gray-700 text-gray-300 hover:border-gray-500'
                          : 'border-gray-300 text-gray-700 hover:border-gray-500',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {favoriteShaders.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-[10px] font-bold uppercase text-gray-500">Favorites</div>
              <div className="flex flex-wrap gap-1">
                {favoriteShaders.map(option => (
                  <button
                    key={`favorite-${option.id}`}
                    type="button"
                    onClick={() => {
                      onSelectShader(option.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'rounded border px-2 py-1 text-xs font-mono',
                      selectedShader === option.id
                        ? 'border-cyan-500 text-cyan-400'
                        : isDarkMode
                          ? 'border-gray-700 text-gray-300 hover:border-gray-500'
                          : 'border-gray-300 text-gray-700 hover:border-gray-500',
                    )}
                  >
                    ★ {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mb-1 text-[10px] font-bold uppercase text-gray-500">All shaders</div>
          <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
            {shaderOptions.map((option, index) => renderShaderCard(option, index))}
          </div>
        </div>
      )}
    </div>
  );
}
