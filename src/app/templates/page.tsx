'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { borderCss } from '@/lib/templateBorders';
import { WarningIcon, DocumentIcon, RefreshIcon } from '@/components/SocialIcons';

interface FormField {
  key: string;
  type: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

interface Template {
  id: string;
  _id: string;
  name: string;
  description: string;
  category: string;
  placeholders: string[];
  formSchema: FormField[];
  pdfUrl: string;
  wordUrl: string;
  isPublic: boolean;
  createdByType: string;
  createdByUserId?: string;
  createdByEmail?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  purchaseCount?: number;
  rank?: number | null;
  isFavorite?: boolean;
}

export default function TemplatesPage() {
  const { data: session } = useSession();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'my' | 'public'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [templateBorderPreference, setTemplateBorderPreference] = useState({
    style: 'solid',
    color: 'blue',
    width: '2px'
  });
  const [favoriteTemplateIds, setFavoriteTemplateIds] = useState<string[]>([]);

  useEffect(() => {
    fetchTemplates();
    fetchUserPreferences();
  }, [session]);

  const fetchUserPreferences = async () => {
    if (!session) return;
    
    try {
      const [profileResponse, favoritesResponse] = await Promise.all([
        fetch('/api/user/profile'),
        fetch('/api/user/favorites')
      ]);

      if (profileResponse.ok) {
        const profileData = await profileResponse.json();
        if (profileData.success && profileData.profile.templateBorderPreference) {
          setTemplateBorderPreference(profileData.profile.templateBorderPreference);
        }
      }

      if (favoritesResponse.ok) {
        const favoritesData = await favoritesResponse.json();
        if (favoritesData.success) {
          setFavoriteTemplateIds(favoritesData.favoriteTemplateIds || []);
        }
      }
    } catch (error) {
      console.error('Error fetching user preferences:', error);
    }
  };

  const toggleFavorite = async (templateId: string, isFavorite: boolean) => {
    if (!session) {
      // Redirect to sign in if not authenticated
      window.location.href = '/auth/signin';
      return;
    }

    try {
      const method = isFavorite ? 'DELETE' : 'POST';
      const response = await fetch('/api/user/favorites', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      });

      const data = await response.json();
      if (data.success) {
        setFavoriteTemplateIds(data.favoriteTemplateIds || []);
        // Update template in local state
        setTemplates(prevTemplates =>
          prevTemplates.map(t =>
            t.id === templateId ? { ...t, isFavorite: !isFavorite } : t
          )
        );
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
    }
  };

  const fetchTemplates = async () => {
    try {
      const response = await fetch('/api/templates');
      const result = await response.json();

      if (result.success) {
        setTemplates(result.templates);
      } else {
        setError(result.error || 'Failed to load templates');
      }
    } catch (error) {
      console.error('Error fetching templates:', error);
      setError('Failed to load templates');
    } finally {
      setIsLoading(false);
    }
  };

  // Get user email for filtering
  const userEmail = session?.user?.email?.toLowerCase();

  // Filter templates based on selected filter
  const filteredTemplates = templates.filter(template => {
    // Filter by type
    if (filterType === 'my') {
      if (!userEmail) return false;
      const isMyTemplate = template.createdByEmail?.toLowerCase() === userEmail ||
                          template.createdByUserId?.toString() === (session?.user as any)?.id;
      if (!isMyTemplate) return false;
    } else if (filterType === 'public') {
      if (!template.isPublic) return false;
    }

    // Filter by search term
    const matchesSearch = template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         template.description.toLowerCase().includes(searchTerm.toLowerCase());

    // Filter by category
    const matchesCategory = filterCategory === 'all' || template.category === filterCategory;

    return matchesSearch && matchesCategory;
  });

  // Get top 3 templates for featured section
  const topTemplates = templates
    .filter(t => t.rank && t.rank <= 3)
    .sort((a, b) => (a.rank || 999) - (b.rank || 999))
    .slice(0, 3);

  // Get templates excluding top 3 for main grid
  const regularTemplates = filteredTemplates.filter(t => !t.rank || t.rank > 3);

  // Helper function to get border style for a template
  const getBorderStyle = (template: Template) => {
    // Rank 1: Gold border
    if (template.rank === 1) {
      return {
        borderWidth: '4px',
        borderStyle: 'solid',
        borderColor: '#fbbf24', // gold-400
      };
    }
    // Rank 2: Silver border
    if (template.rank === 2) {
      return {
        borderWidth: '4px',
        borderStyle: 'solid',
        borderColor: '#9ca3af', // gray-400
      };
    }
    // Rank 3: Bronze border
    if (template.rank === 3) {
      return {
        borderWidth: '4px',
        borderStyle: 'solid',
        borderColor: '#ea580c', // orange-600
      };
    }
    // Favorite: User's custom border
    if (template.isFavorite) {
      return borderCss(templateBorderPreference);
    }
    // Default: no special border
    return {};
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading templates...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <WarningIcon size={64} className="w-16 h-16 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-red-800 mb-2">Error</h3>
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={fetchTemplates}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Available Templates
            </h1>
            <p className="text-xl text-gray-600">
              Choose a template and fill out the form to generate your personalized document
            </p>
          </div>
          {session && (
            <Link
              href="/templates/create"
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Create Template
            </Link>
          )}
        </div>

        {/* Top Templates Section */}
        {topTemplates.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">🏆 Top Templates</h2>
            <div className="grid md:grid-cols-3 gap-6 mb-8">
              {topTemplates.map((template) => {
                const rankEmoji = template.rank === 1 ? '🥇' : template.rank === 2 ? '🥈' : '🥉';
                const rankBgColor = template.rank === 1 ? '#fbbf24' : template.rank === 2 ? '#9ca3af' : '#ea580c';
                
                return (
                  <div
                    key={template.id}
                    className="bg-white rounded-lg shadow-xl p-6 hover:shadow-2xl transition-all transform hover:-translate-y-1 relative overflow-hidden"
                    style={getBorderStyle(template)}
                  >
                    {/* Rank Badge */}
                    <div 
                      className="absolute top-0 right-0 text-white px-3 py-1 rounded-bl-lg font-bold text-lg"
                      style={{ backgroundColor: rankBgColor }}
                    >
                      {rankEmoji} #{template.rank}
                    </div>
                    
                    {/* Favorite Button */}
                    {session && (
                      <button
                        onClick={() => toggleFavorite(template.id, template.isFavorite || false)}
                        className="absolute top-2 left-2 p-2 rounded-full hover:bg-gray-100 transition-colors"
                        title={template.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <svg
                          className={`w-5 h-5 ${template.isFavorite ? 'fill-red-500 text-red-500' : 'text-gray-400'}`}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" />
                        </svg>
                      </button>
                    )}

                    <div className="mt-8">
                      <h3 className="text-xl font-semibold text-gray-900 mb-2">{template.name}</h3>
                      <p className="text-gray-600 text-sm mb-4">{template.description}</p>
                      
                      {/* Purchase Count Badge */}
                      {template.purchaseCount !== undefined && template.purchaseCount > 0 && (
                        <div className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded mb-4">
                          Used {template.purchaseCount} {template.purchaseCount === 1 ? 'time' : 'times'}
                        </div>
                      )}

                      <Link
                        href={`/templates/fill/${template.id}`}
                        className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 font-medium text-center block mt-4"
                      >
                        Use Template
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Filter</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as 'all' | 'my' | 'public')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Templates</option>
                {session && <option value="my">My Templates</option>}
                <option value="public">Public Templates</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
              <input
                type="text"
                placeholder="Search templates..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Categories</option>
                <option value="lab-manual">Lab Manual</option>
                <option value="assignment">Assignment</option>
                <option value="report">Report</option>
                <option value="certificate">Certificate</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={fetchTemplates}
                className="w-full bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <RefreshIcon size={18} className="w-4.5 h-4.5" />
                  Refresh
                </span>
              </button>
            </div>
          </div>
        </div>

        {filteredTemplates.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow-sm">
            <div className="flex justify-center mb-4">
              <DocumentIcon size={64} className="w-16 h-16 text-gray-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800 mb-2">No Templates Found</h3>
            <p className="text-gray-600 mb-4">
              {searchTerm || filterCategory !== 'all' || filterType !== 'all'
                ? 'Try adjusting your search or filters.'
                : 'There are no templates available at the moment. Please check back later.'
              }
            </p>
            {session && !searchTerm && filterCategory === 'all' && filterType === 'all' && (
              <Link
                href="/templates/create"
                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 inline-block"
              >
                Create Your First Template
              </Link>
            )}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {regularTemplates.map((template) => {
              const isMyTemplate = userEmail && (
                template.createdByEmail?.toLowerCase() === userEmail ||
                template.createdByUserId?.toString() === (session?.user as any)?.id
              );
              const borderStyle = getBorderStyle(template);

              return (
                <div
                  key={template.id}
                  className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-all transform hover:-translate-y-1 relative"
                  style={borderStyle}
                >
                  {/* Favorite Button */}
                  {session && (
                    <button
                      onClick={() => toggleFavorite(template.id, template.isFavorite || false)}
                      className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 transition-colors z-10"
                      title={template.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <svg
                        className={`w-5 h-5 ${template.isFavorite ? 'fill-red-500 text-red-500' : 'text-gray-400'}`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" />
                      </svg>
                    </button>
                  )}

                  {/* Ownership Badge */}
                  {isMyTemplate && (
                    <div className="absolute top-4 right-12 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">
                      My Template
                    </div>
                  )}
                  {template.isPublic && !isMyTemplate && !template.isFavorite && (
                    <div className="absolute top-4 right-12 px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">
                      Public
                    </div>
                  )}

                  {/* Favorite Badge */}
                  {template.isFavorite && (
                    <div className="absolute top-4 right-12 px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded flex items-center gap-1">
                      <svg className="w-3 h-3 fill-red-500" viewBox="0 0 20 20">
                        <path d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" />
                      </svg>
                      Favorite
                    </div>
                  )}

                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xl font-semibold text-gray-900 pr-16">
                        {template.name}
                      </h3>
                      <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                        {template.category.replace('-', ' ')}
                      </span>
                    </div>
                    <p className="text-gray-600 text-sm mb-2">
                      {template.description}
                    </p>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                      <span>Created: {new Date(template.createdAt).toLocaleDateString()}</span>
                      {template.createdByName && !isMyTemplate && (
                        <span>By: {template.createdByName}</span>
                      )}
                    </div>
                    
                    {/* Purchase Count Badge */}
                    {template.purchaseCount !== undefined && template.purchaseCount > 0 && (
                      <div className="inline-block bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded">
                        Used {template.purchaseCount} {template.purchaseCount === 1 ? 'time' : 'times'}
                      </div>
                    )}
                  </div>

                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Required Information:</h4>
                    <div className="space-y-1">
                      {template.placeholders.slice(0, 3).map((placeholder) => (
                        <div key={placeholder} className="text-sm text-gray-600">
                          • {placeholder.charAt(0).toUpperCase() + placeholder.slice(1).replace(/([A-Z])/g, ' $1')}
                        </div>
                      ))}
                      {template.placeholders.length > 3 && (
                        <div className="text-sm text-gray-500">
                          +{template.placeholders.length - 3} more fields
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-200">
                    <Link
                      href={`/templates/fill/${template.id}`}
                      className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 font-medium text-center block"
                    >
                      Fill Out Template
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-12 text-center">
          <div className="bg-blue-50 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-blue-900 mb-2">
              How It Works
            </h3>
            <div className="grid md:grid-cols-3 gap-4 text-sm text-blue-800">
              <div>
                <div className="font-semibold mb-1">1. Choose Template</div>
                <p>Select a template that matches your needs</p>
              </div>
              <div>
                <div className="font-semibold mb-1">2. Fill Information</div>
                <p>Complete the form with your details</p>
              </div>
              <div>
                <div className="font-semibold mb-1">3. Get Your Document</div>
                <p>Receive your personalized PDF instantly</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}