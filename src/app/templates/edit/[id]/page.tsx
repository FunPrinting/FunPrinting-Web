'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { DownloadIcon, WarningIcon } from '@/components/SocialIcons';

interface Template {
  id: string;
  _id: string;
  name: string;
  description: string;
  category: string;
  placeholders: string[];
  pdfUrl: string;
  wordUrl?: string;
  isPublic: boolean;
  isPaid: boolean;
  price?: number;
  allowFreeDownload?: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function EditTemplatePage() {
  const router = useRouter();
  const params = useParams();
  const { status } = useSession();
  const templateId = params.id as string;

  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'other',
    isPaid: false,
    price: 0,
    allowFreeDownload: true,
    isPublic: false,
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string>('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
      return;
    }
    if (status === 'authenticated' && templateId) {
      fetchTemplate();
    }
  }, [status, templateId, router]);

  const fetchTemplate = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/templates/${templateId}`);
      const data = await response.json();

      if (data.success && data.template) {
        const t = data.template;
        setTemplate(t);
        const initialFormData = {
          name: t.name || '',
          description: t.description || '',
          category: t.category || 'other',
          isPaid: t.isPaid || false,
          price: t.price || 0,
          allowFreeDownload: t.allowFreeDownload !== false,
          isPublic: t.isPublic || false,
        };
        
        
        setFormData(initialFormData);
      } else {
        setError(data.error || 'Failed to fetch template');
      }
    } catch (error) {
      console.error('Error fetching template:', error);
      setError('Failed to load template');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;


    setFormData(prev => {
      const newFormData = {
      ...prev,
      [name]: type === 'checkbox' ? checked : type === 'number' ? parseFloat(value) || 0 : value
      };
      
      
      return newFormData;
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const allowedTypes = [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword'
      ];
      
      if (!allowedTypes.includes(file.type) && !file.name.endsWith('.docx')) {
        setError('Only DOCX files are allowed');
        return;
      }

      // Validate file size (50MB)
      if (file.size > 50 * 1024 * 1024) {
        setError('File size must be less than 50MB');
        return;
      }

      setSelectedFile(file);
      setFilePreview(file.name);
      setError(null);
    }
  };

  const handleDownload = async () => {
    if (!template?.wordUrl) {
      setError('No template file available to download');
      return;
    }

    try {
      // Fetch the file from the URL
      const response = await fetch(template.wordUrl);
      if (!response.ok) {
        throw new Error('Failed to download file');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${template.name || 'template'}.docx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setSuccess('Template file downloaded successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error downloading file:', error);
      setError('Failed to download template file');
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file to upload');
      return;
    }

    try {
      setUploading(true);
      setError(null);

      const uploadFormData = new FormData();
      uploadFormData.append('file', selectedFile);

      const response = await fetch(`/api/templates/${templateId}/update-file`, {
        method: 'POST',
        body: uploadFormData,
      });

      const data = await response.json();

      if (data.success) {
        setSuccess('Template file updated successfully!');
        setSelectedFile(null);
        setFilePreview('');
        // Refresh template data
        await fetchTemplate();
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(data.error || 'Failed to update template file');
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      setError('Failed to upload template file');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Validate paid template
      if (formData.isPaid && formData.price <= 0) {
        setError('Paid templates must have a price greater than 0');
        setSaving(false);
        return;
      }


      const response = await fetch(`/api/templates/${templateId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();


      if (data.success) {
        setSuccess('Template updated successfully!');
        // Refresh template data
        await fetchTemplate();
        setTimeout(() => {
          setSuccess(null);
          router.push('/my-templates');
        }, 2000);
      } else {
        setError(data.error || 'Failed to update template');
      }
    } catch (error) {
      console.error('Error saving template:', error);
      setError('Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading template...</p>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return null;
  }

  if (error && !template) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <WarningIcon size={64} className="w-16 h-16 text-red-500" />
          </div>
          <p className="text-red-600 text-lg mb-2">Error Loading Template</p>
          <p className="text-gray-600 mb-4">{error}</p>
          <Link
            href="/my-templates"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 inline-block"
          >
            Back to My Templates
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Link
            href="/my-templates"
            className="text-blue-600 hover:text-blue-800 mb-4 inline-block"
          >
            ← Back to My Templates
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Edit Template</h1>
          <p className="text-gray-600 mt-2">Update your template details and settings</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6">
            {success}
          </div>
        )}

        {template && (
          <form onSubmit={handleSave} className="space-y-6">
            {/* Basic Information */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Basic Information</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Template Name *
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description *
                  </label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    required
                    rows={4}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Category *
                  </label>
                  <select
                    name="category"
                    value={formData.category}
                    onChange={handleInputChange}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="lab-manual">Lab Manual</option>
                    <option value="assignment">Assignment</option>
                    <option value="report">Report</option>
                    <option value="certificate">Certificate</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Monetization Settings */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Monetization Settings</h2>
              
              <div className="space-y-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="isPaid"
                    id="isPaid"
                    checked={formData.isPaid}
                    onChange={handleInputChange}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="isPaid" className="ml-2 block text-sm text-gray-900">
                    Make this a paid template
                  </label>
                </div>

                {formData.isPaid && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Price (₹) *
                    </label>
                    <input
                      type="number"
                      name="price"
                      value={formData.price}
                      onChange={handleInputChange}
                      min="0"
                      step="0.01"
                      required={formData.isPaid}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Set the price users will pay to use this template
                    </p>
                  </div>
                )}

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="allowFreeDownload"
                    id="allowFreeDownload"
                    checked={formData.allowFreeDownload}
                    onChange={handleInputChange}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="allowFreeDownload" className="ml-2 block text-sm text-gray-900">
                    Allow free download (users can download without payment)
                  </label>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="isPublic"
                    id="isPublic"
                    checked={formData.isPublic}
                    onChange={handleInputChange}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="isPublic" className="ml-2 block text-sm text-gray-900">
                    Make template public (visible to all users)
                  </label>
                </div>
              </div>
            </div>

            {/* Template File Management */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Template File</h2>
              
              <div className="space-y-4">
                {template.wordUrl && (
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Current Template File</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {template.placeholders.length} placeholders detected
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <DownloadIcon size={18} className="w-4.5 h-4.5" />
                        Download
                      </span>
                    </button>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Replace Template File (DOCX)
                  </label>
                  <input
                    type="file"
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={handleFileChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {filePreview && (
                    <p className="mt-2 text-sm text-gray-600">Selected: {filePreview}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    Upload a new DOCX file to replace the current template. Placeholders will be automatically extracted.
                  </p>
                  
                  {selectedFile && (
                    <button
                      type="button"
                      onClick={handleFileUpload}
                      disabled={uploading}
                      className="mt-3 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
                    >
                      {uploading ? 'Uploading...' : 'Upload New File'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Template Info */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Template Information</h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Placeholders</p>
                  <p className="font-medium text-gray-900">{template.placeholders.length}</p>
                </div>
                <div>
                  <p className="text-gray-500">Created</p>
                  <p className="font-medium text-gray-900">
                    {new Date(template.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Last Updated</p>
                  <p className="font-medium text-gray-900">
                    {new Date(template.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Status</p>
                  <p className="font-medium text-gray-900">
                    {template.isPublic ? 'Public' : 'Private'}
                  </p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-4">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <Link
                href="/my-templates"
                className="bg-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-400 font-medium text-center"
              >
                Cancel
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

