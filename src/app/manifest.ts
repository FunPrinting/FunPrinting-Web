import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Fun Printing Store',
    short_name: 'FunPrinting',
    description: 'Fast, affordable printing services and templates delivered to your door.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#4f46e5',
    icons: [
      {
        src: '/fun-printing-printing-service-favicon.jpg',
        sizes: '192x192',
        type: 'image/jpeg',
      },
      {
        src: '/fun-printing-printing-service-favicon.jpg',
        sizes: '512x512',
        type: 'image/jpeg',
      },
    ],
  };
}
