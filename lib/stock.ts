import { AppError } from './errors';

// Free stock photos from Pixabay (PIXABAY_API_KEY) or Pexels (PEXELS_API_KEY). Both licenses
// allow commercial use and edits without attribution; the photographer is still credited in
// the editor. Pixabay asks that images be downloaded rather than hotlinked, which is what
// happens here: the chosen photo is saved as the story background.
export type StockPhoto = {
  id: string;
  alt: string;
  photographer: string;
  photographerUrl: string;
  url: string;
  thumb: string;
  full: string;
};

let fetcher: typeof fetch = (input, init) => fetch(input, init);
export function setStockFetch(next: typeof fetch) {
  fetcher = next;
}
type Provider = 'pixabay' | 'pexels';
function provider(): Provider | null {
  if (process.env.PIXABAY_API_KEY) return 'pixabay';
  if (process.env.PEXELS_API_KEY) return 'pexels';
  return null;
}
export const stockConfigured = () => !!provider();
export const stockName = () => (provider() === 'pexels' ? 'Pexels' : 'Pixabay');

async function get<T>(url: string, headers: Record<string, string> = {}) {
  const response = await fetcher(url, { headers });
  if (response.status === 429)
    throw new AppError(`${stockName()} rate limit reached. Try stock photos again in a minute.`);
  if (!response.ok) throw new AppError(`${stockName()} search failed (${response.status}).`);
  return (await response.json()) as T;
}

type PixabayHit = {
  id: number;
  pageURL: string;
  tags: string;
  webformatURL: string;
  largeImageURL: string;
  user: string;
  user_id: number;
};
const fromPixabay = (hit: PixabayHit): StockPhoto => ({
  id: `pixabay:${hit.id}`,
  alt: hit.tags,
  photographer: hit.user,
  photographerUrl: `https://pixabay.com/users/${encodeURIComponent(hit.user)}-${hit.user_id}/`,
  url: hit.pageURL,
  thumb: hit.webformatURL,
  full: hit.largeImageURL,
});
const pixabay = (params: string) =>
  get<{ hits: PixabayHit[] }>(
    `https://pixabay.com/api/?key=${encodeURIComponent(process.env.PIXABAY_API_KEY!)}&${params}`,
  ).then((data) => data.hits.map(fromPixabay));

type PexelsPhoto = {
  id: number;
  alt?: string;
  url: string;
  photographer: string;
  photographer_url: string;
  src: { original: string; medium: string; portrait: string };
};
const fromPexels = (photo: PexelsPhoto): StockPhoto => ({
  id: `pexels:${photo.id}`,
  alt: photo.alt || '',
  photographer: photo.photographer,
  photographerUrl: photo.photographer_url,
  url: photo.url,
  thumb: photo.src.portrait || photo.src.medium,
  // Pexels resizes on its CDN, so only a story-sized image is downloaded.
  full: `${photo.src.original}?auto=compress&cs=tinysrgb&fit=crop&w=1080&h=1920`,
});
const pexels = <T>(path: string) =>
  get<T>(`https://api.pexels.com/v1${path}`, { Authorization: process.env.PEXELS_API_KEY! });

export async function searchStock(query: string, perPage = 15) {
  const q = query.trim().slice(0, 100);
  if (!q) throw new AppError('Enter a few words to search stock photos.');
  const which = provider();
  if (!which) throw new AppError('Add PIXABAY_API_KEY to the environment to use stock photos.');
  if (which === 'pixabay')
    return pixabay(
      `q=${encodeURIComponent(q)}&image_type=photo&orientation=vertical&safesearch=true&min_height=1200&per_page=${perPage}`,
    );
  const data = await pexels<{ photos: PexelsPhoto[] }>(
    `/search?query=${encodeURIComponent(q)}&orientation=portrait&size=large&per_page=${perPage}`,
  );
  return data.photos.map(fromPexels);
}
export async function getStock(id: string) {
  const [source, number] = id.split(':');
  if (!/^\d+$/.test(number || '') || source !== provider())
    throw new AppError('This stock photo is no longer available. Search again.');
  if (source === 'pixabay') {
    const [photo] = await pixabay(`id=${number}`);
    if (!photo) throw new AppError('This stock photo is no longer available. Search again.');
    return photo;
  }
  return fromPexels(await pexels<PexelsPhoto>(`/photos/${number}`));
}
export async function downloadStock(photo: StockPhoto) {
  const response = await fetcher(photo.full);
  if (!response.ok) throw new AppError('The stock photo could not be downloaded. Try another.');
  return Buffer.from(await response.arrayBuffer());
}
