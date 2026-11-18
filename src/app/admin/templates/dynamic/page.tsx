'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminNavigation from '@/components/admin/AdminNavigation';
import LoadingSpinner from '@/components/admin/LoadingSpinner';
import AdminGoogleAuth from '@/components/admin/AdminGoogleAuth';
import { getCategoryIcon, getCategoryColor } from '@/lib/adminUtils';
import { WarningIcon, DocumentIcon, RefreshIcon } from '@/components/SocialIcons';

interface Template {
  id: string;
  _id: string;
  name: string;
  description: string;
  category: string;
  pdfUrl: string;
  placeholders: string[];
  isPublic: boolean;
  createdByType: string;
  createdByEmail?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

interface UserGroup {
  userInfo: {
    email: string;
    name: string;
    templateCount: number;
  };
  templates: Template[];
}

function ManageDynamicTemplatesContent() {
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterUser, setFilterUser] = useState('all');
  const [togglingPublic, setTogglingPublic] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/templates/all');
      const data = await response.json();
      
      if (data.success) {
        setUserGroups(data.users);
      } else {
        setError('Failed to fetch templates');
      }
    } catch (error) {
      console.error('Error fetching templates:', error);
      setError('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePublic = async (templateId: string, currentStatus: boolean) => {
    try {
      setTogglingPublic(templateId);
      const response = await fetch(`/api/admin/templates/${templateId}/toggle-public`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: !currentStatus }),
      });

      if (response.ok) {
        // Refresh templates
        await fetchTemplates();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to update template');
      }
    } catch (error) {
      console.error('Error toggling public status:', error);
      alert('Failed to update template');
    } finally {
      setTogglingPublic(null);
    }
  };

  const handleDelete = async (templateId: string) => {
    try {
      setDeleteLoading(true);
      const response = await fetch(`/api/admin/templates/dynamic/${templateId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Refresh templates
        await fetchTemplates();
        setShowDeleteModal(false);
        setSelectedTemplate(null);
      } else {
        alert('Failed to delete template');
      }
    } catch (error) {
      console.error('Error deleting template:', error);
      alert('Error deleting template');
    } finally {
      setDeleteLoading(false);
    }
  };

  // Flatten all templates for filtering
  const allTemplates = userGroups.flatMap(group => group.templates);

  // Filter templates
  const filteredUserGroups = userGroups.map(group => {
    const filteredTemplates = group.templates.filter(template => {
      const matchesSearch = template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           template.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = filterCategory === 'all' || template.category === filterCategory;
      const matchesUser = filterUser === 'all' || group.userInfo.email === filterUser;
      return matchesSearch && matchesCategory && matchesUser;
    });

    return {
      ...group,
      templates: filteredTemplates
    };
  }).filter(group => group.templates.length > 0);

  if (loading) {
    return <LoadingSpinner message="Loading templates..." />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <WarningIcon size={64} className="w-16 h-16 text-red-500" />
          </div>
          <p className="text-red-600 text-lg mb-2">Error Loading Templates</p>
          <p className="text-gray-600 mb-4">{error}</p>
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <AdminNavigation
          title="Manage Dynamic Templates"
          subtitle="Create, edit, and manage your dynamic templates"
          actions={
            <Link
              href="/admin/templates/dynamic/upload"
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Create New Template
            </Link>
          }
        />

        {/* Search and Filters */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Search Templates</label>
              <input
                type="text"
                placeholder="Search by name or description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="form-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Category</label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="form-input"
              >
                <option value="all">All Categories</option>
                <option value="lab-manual">Lab Manual</option>
                <option value="assignment">Assignment</option>
                <option value="report">Report</option>
                <option value="certificate">Certificate</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Filter by User</label>
              <select
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                className="form-input"
              >
                <option value="all">All Users</option>
                {userGroups.map((group) => (
                  <option key={group.userInfo.email} value={group.userInfo.email}>
                    {group.userInfo.name} ({group.userInfo.templateCount})
                  </option>
                ))}
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

        {/* Templates Grouped by User */}
        {filteredUserGroups.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow-sm">
            <div className="flex justify-center mb-4">
              <DocumentIcon size={64} className="w-16 h-16 text-gray-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {searchTerm || filterCategory !== 'all' || filterUser !== 'all' ? 'No Templates Found' : 'No Templates Yet'}
            </h2>
            <p className="text-gray-600 mb-6">
              {searchTerm || filterCategory !== 'all' || filterUser !== 'all'
                ? 'Try adjusting your search or filters.'
                : 'Create your first dynamic template to get started!'
              }
            </p>
            {!searchTerm && filterCategory === 'all' && filterUser === 'all' && (
              <Link
                href="/admin/templates/dynamic/upload"
                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 inline-block"
              >
                Create First Template
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {filteredUserGroups.map((group) => (
              <div key={group.userInfo.email} className="bg-white rounded-lg shadow-sm p-6">
                {/* User Header */}
                <div className="mb-6 pb-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">{group.userInfo.name}</h2>
                      <p className="text-sm text-gray-600">{group.userInfo.email}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-600">{group.userInfo.templateCount}</div>
                      <div className="text-sm text-gray-600">Templates</div>
                    </div>
                  </div>
                </div>

                {/* Templates Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {group.templates.map((template) => (
                    <div
                      key={template.id}
                      className="bg-gray-50 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 overflow-hidden border border-gray-200"
                    >
                      {/* Template Preview */}
                      <div className="h-32 bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center relative">
                        <div className="text-center">
                          <div className="flex justify-center mb-1">
                            <DocumentIcon size={40} className="w-10 h-10" />
                          </div>
                          <p className="text-xs text-gray-600">Template</p>
                        </div>
                        
                        {/* Category Badge */}
                        <div className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${getCategoryColor(template.category)}`}>
                          {(() => {
                            const IconComponent = getCategoryIcon(template.category);
                            return <IconComponent size={14} className="w-3.5 h-3.5" />;
                          })()}
                          {template.category.replace('-', ' ')}
                        </div>

                        {/* Public Badge */}
                        {template.isPublic && (
                          <div className="absolute top-2 left-2 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Public
                          </div>
                        )}
                      </div>

                      {/* Template Info */}
                      <div className="p-4">
                        <h3 className="text-base font-semibold text-gray-900 mb-2 line-clamp-2">
                          {template.name}
                        </h3>
                        
                        <p className="text-gray-600 text-xs mb-3 line-clamp-2">
                          {template.description}
                        </p>

                        {/* Placeholders count and date */}
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs text-gray-500">
                            {template.placeholders.length} fields
                          </span>
                          <span className="text-xs text-gray-400">
                            {new Date(template.createdAt).toLocaleDateString()}
                          </span>
                        </div>

                        {/* Action Buttons */}
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <button
                            onClick={() => router.push(`/templates/fill/${template.id}`)}
                            className="bg-blue-600 text-white py-1.5 px-2 rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium"
                          >
                            View
                          </button>
                          <button
                            onClick={() => router.push(`/admin/templates/dynamic/edit/${template.id}`)}
                            className="bg-green-600 text-white py-1.5 px-2 rounded-lg hover:bg-green-700 transition-colors text-xs font-medium"
                          >
                            Edit
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => handleTogglePublic(template.id, template.isPublic)}
                            disabled={togglingPublic === template.id}
                            className={`py-1.5 px-2 rounded-lg transition-colors text-xs font-medium ${
                              template.isPublic
                                ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                                : 'bg-gray-600 text-white hover:bg-gray-700'
                            } disabled:opacity-50`}
                          >
                            {togglingPublic === template.id ? '...' : template.isPublic ? 'Make Private' : 'Make Public'}
                          </button>
                          <button
                            onClick={() => {
                              setSelectedTemplate(template);
                              setShowDeleteModal(true);
                            }}
                            className="bg-red-600 text-white py-1.5 px-2 rounded-lg hover:bg-red-700 transition-colors text-xs font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-sm p-6 text-center">
            <div className="text-2xl font-bold text-blue-600">{allTemplates.length}</div>
            <div className="text-gray-600">Total Templates</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6 text-center">
            <div className="text-2xl font-bold text-green-600">
              {allTemplates.filter(t => t.category === 'lab-manual').length}
            </div>
            <div className="text-gray-600">Lab Manuals</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6 text-center">
            <div className="text-2xl font-bold text-purple-600">
              {allTemplates.filter(t => t.category === 'assignment').length}
            </div>
            <div className="text-gray-600">Assignments</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6 text-center">
            <div className="text-2xl font-bold text-yellow-600">
              {allTemplates.filter(t => t.isPublic).length}
            </div>
            <div className="text-gray-600">Public Templates</div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedTemplate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Delete Template</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete &quot;{selectedTemplate.name}&quot;? This action cannot be undone.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(selectedTemplate._id)}
                disabled={deleteLoading}
                className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleteLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ManageDynamicTemplates() {
  return (
    <AdminGoogleAuth 
      title="Dynamic Templates"
      subtitle="Sign in with Google to manage dynamic Word templates"
    >
      <ManageDynamicTemplatesContent />
    </AdminGoogleAuth>
  );
}
