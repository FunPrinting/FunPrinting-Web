'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { startTemplateCheckout } from '@/lib/payments/client';
import InlineAuthModal from '@/components/InlineAuthModal';
import { WarningIcon, DocumentIcon, MemoIcon, LockIcon } from '@/components/SocialIcons';

interface FormField {
  key: string;
  type: string;
  label: string;
  required: boolean;
  placeholder?: string;
  defaultPlaceholder?: string;
}

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  placeholders: string[];
  formSchema: FormField[];
  pdfUrl: string;
  wordUrl: string;
  createdAt: string;
  updatedAt: string;
  isPaid?: boolean;
  price?: number;
  allowFreeDownload?: boolean;
}

interface FormData {
  [key: string]: string;
}

type Step = 'filling' | 'payment' | 'complete';

export default function TemplateFillPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();
  const isAuthenticated = !!session?.user;
  const [template, setTemplate] = useState<Template | null>(null);
  const [formData, setFormData] = useState<FormData>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);
  const [redirectMessage, setRedirectMessage] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('filling');
  const [generatedWordUrl, setGeneratedWordUrl] = useState<string | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');

  useEffect(() => {
    const getParams = async () => {
      const resolvedParams = await params;
      setTemplateId(resolvedParams.id);
    };
    getParams();
  }, [params]);

  useEffect(() => {
    if (templateId) {
      fetchTemplate();
    }
  }, [templateId]);

  const fetchTemplate = async () => {
    try {
      const response = await fetch(`/api/admin/save-template?id=${templateId}`);
      const result = await response.json();

      if (result.success) {
        console.log('[RENDER] Received template from API');
        console.log('[RENDER] Template placeholders:', result.data.template.placeholders);
        console.log('[RENDER] Template formSchema exists:', !!result.data.template.formSchema);
        console.log('[RENDER] Template formSchema is array:', Array.isArray(result.data.template.formSchema));
        console.log('[RENDER] Template formSchema length:', result.data.template.formSchema?.length || 0);
        
        setTemplate(result.data.template);
        // Initialize form data with empty values
        const initialFormData: FormData = {};
        
        // Check if formSchema exists and is an array
        if (result.data.template.formSchema && Array.isArray(result.data.template.formSchema)) {
          console.log('[RENDER] Using formSchema to initialize form data');
          console.log('[RENDER] FormSchema fields:', result.data.template.formSchema.map((f: FormField) => ({ key: f.key, label: f.label })));
          console.log('[RENDER] FormSchema keys:', result.data.template.formSchema.map((f: FormField) => f.key));
          result.data.template.formSchema.forEach((field: FormField) => {
            initialFormData[field.key] = '';
          });
        } else if (result.data.template.placeholders && Array.isArray(result.data.template.placeholders)) {
          // Fallback: use placeholders array to create form data
          console.log('[RENDER] Using placeholders array as fallback');
          result.data.template.placeholders.forEach((placeholder: string) => {
            initialFormData[placeholder] = '';
          });
        }
        
        console.log('[RENDER] Initialized formData keys:', Object.keys(initialFormData));
        setFormData(initialFormData);
      } else {
        setError(result.error || 'Template not found');
      }
    } catch (error) {
      console.error('Error fetching template:', error);
      setError('Failed to load template');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (key: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];
    
    if (!template) return errors;

    // Check if formSchema exists and is an array
    if (template.formSchema && Array.isArray(template.formSchema)) {
      template.formSchema.forEach(field => {
        if (field.required && (!formData[field.key] || formData[field.key].trim() === '')) {
          errors.push(`${field.label} is required`);
        }
      });
    } else if (template.placeholders && Array.isArray(template.placeholders)) {
      // Fallback: validate placeholders as required fields
      template.placeholders.forEach(placeholder => {
        if (!formData[placeholder] || formData[placeholder].trim() === '') {
          errors.push(`${placeholder} is required`);
        }
      });
    }

    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const errors = validateForm();
    if (errors.length > 0) {
      setError(errors.join(', '));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      console.log('🔄 Preparing to generate filled document...');
      console.log('[SUBMIT] Form data keys:', Object.keys(formData));
      console.log('[SUBMIT] Form data:', formData);
      console.log('[SUBMIT] Template formSchema keys:', template?.formSchema?.map(f => f.key) || []);
      console.log('[SUBMIT] Missing fields in formData:', 
        template?.formSchema?.filter(f => !formData[f.key])?.map(f => f.key) || []
      );

      // Check if template is paid - if so, show payment page immediately (no document generation yet)
      if (template?.isPaid && (template.price ?? 0) > 0) {
        console.log('💰 Paid template detected, showing payment step...');
        
        // Store form data in sessionStorage before showing payment
        // This will be used by loading page after payment is completed
        if (typeof window !== 'undefined' && template?.id) {
          sessionStorage.setItem('pendingTemplateFormData', JSON.stringify({
            templateId: template.id,
            formData: formData
          }));
          console.log('✅ Form data stored in sessionStorage for post-payment generation');
        }
        
        // Show payment step immediately (no document generation yet)
        setStep('payment');
        setIsSubmitting(false);
        return;
      }

      // Free template - store form data and redirect to loading page
      // Store form data in sessionStorage for loading page
      // This allows immediate redirect without waiting for API response
      if (typeof window !== 'undefined' && template?.id) {
        sessionStorage.setItem('pendingTemplateFormData', JSON.stringify({
          templateId: template.id,
          formData
        }));
        console.log('✅ Form data stored in sessionStorage, redirecting to loading page...');
      }

      // Immediately redirect to loading page
      // Loading page will make the API call and handle the response
      router.push(`/templates/fill/${templateId}/loading`);
      
    } catch (error) {
      console.error('❌ Error preparing document generation:', error);
      let errorMessage = 'Failed to prepare document generation. Please try again.';
      
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      setError(errorMessage);
      setIsSubmitting(false);
    }
  };

  const handlePayment = async () => {
    if (!template) return;
    setIsProcessingPayment(true);
    setError(null);
    try {
      // Redirects to Razorpay; the status page continues to document generation
      if (!templateId) throw new Error('Template not found');
      await startTemplateCheckout(templateId, formData as Record<string, unknown>);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Payment failed. Please try again.');
      setIsProcessingPayment(false);
    }
  };

  const handleDownload = async () => {
    if (!generatedWordUrl) return;
    
    try {
      // Fetch Word document from URL
      const response = await fetch(generatedWordUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch document');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${template?.name?.replace(/[^\w\-\s\.]/g, '').trim().replace(/\s+/g, '-') || 'document'}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      console.log('✅ Document downloaded successfully');
    } catch (error) {
      console.error('❌ Error downloading document:', error);
      setError('Failed to download document. Please try again.');
    }
  };

  const handleContinueToOrder = () => {
    if (!generatedWordUrl || !template) return;
    
    // Store order data in sessionStorage for the order page
    const orderData = {
      templateId: templateId,
      templateName: template.name,
      wordUrl: generatedWordUrl,
      customerData: formData,
      isTemplateDocument: true
    };
    
    sessionStorage.setItem('pendingTemplateDocument', JSON.stringify(orderData));
    
    // Redirect to order page
    router.push('/order');
  };


  const renderFormField = (field: FormField) => {
    // Use placeholder if available, otherwise use defaultPlaceholder, otherwise generate default
    const displayPlaceholder = field.placeholder || (field as any).defaultPlaceholder || `Enter ${field.key || field.label || ''}`;
    
    const commonProps = {
      id: field.key,
      name: field.key,
      value: formData[field.key] || '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => 
        handleInputChange(field.key, e.target.value),
      placeholder: displayPlaceholder,
      required: field.required,
      className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
    };

    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            {...commonProps}
            rows={3}
            className={`${commonProps.className} resize-vertical`}
          />
        );
      case 'email':
        return (
          <input
            {...commonProps}
            type="email"
          />
        );
      case 'tel':
        return (
          <input
            {...commonProps}
            type="tel"
          />
        );
      case 'date':
        return (
          <input
            {...commonProps}
            type="date"
          />
        );
      case 'number':
        return (
          <input
            {...commonProps}
            type="number"
          />
        );
      default:
        return (
          <input
            {...commonProps}
            type="text"
          />
        );
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading template...</p>
        </div>
      </div>
    );
  }

  if (error && !template) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <WarningIcon size={64} className="w-16 h-16 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-red-800 mb-2">Error</h3>
          <p className="text-red-600 mb-4">{error}</p>
          <Link
            href="/templates"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Back to Templates
          </Link>
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <DocumentIcon size={64} className="w-16 h-16 text-gray-500" />
          </div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Template Not Found</h3>
          <p className="text-gray-600 mb-4">The requested template could not be found.</p>
          <Link
            href="/templates"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Back to Templates
          </Link>
        </div>
      </div>
    );
  }

  // Show payment step
  if (step === 'payment' && template) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-2xl mx-auto px-4">
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <div className="mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Document Generated Successfully!</h2>
              <p className="text-gray-600 mb-4">Please complete the payment to access your document.</p>
            </div>

            <div className="bg-gray-50 rounded-lg p-6 mb-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-600">Template Fee:</span>
                <span className="text-2xl font-bold text-gray-900">₹{template.price}</span>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <p className="text-red-700">{error}</p>
              </div>
            )}

            {!isAuthenticated && (
              <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800 mb-3 flex items-center gap-2">
                  <WarningIcon size={18} className="w-4.5 h-4.5" />
                  <strong>Sign in required:</strong> You need to sign in to make a payment.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setAuthMode('signin'); setShowAuthModal(true); }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => { setAuthMode('signup'); setShowAuthModal(true); }}
                    className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors text-sm font-medium"
                  >
                    Create Account
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-4 justify-center">
              <button
                onClick={() => router.push('/templates')}
                className="bg-gray-300 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!isAuthenticated) {
                    setAuthMode('signin');
                    setShowAuthModal(true);
                    return;
                  }
                  handlePayment();
                }}
                disabled={isProcessingPayment}
                className="bg-blue-600 text-white px-8 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {!isAuthenticated ? (
                  <>
                    <LockIcon size={16} className="w-4 h-4 mr-2" />
                    Sign In to Pay ₹{template.price}
                  </>
                ) : isProcessingPayment ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Processing...
                  </>
                ) : (
                  `Pay ₹${template.price}`
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show complete step (download/order options)
  if (step === 'complete' && template) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-2xl mx-auto px-4">
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <div className="mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Document Ready!</h2>
              <p className="text-gray-600 mb-6">Your document has been generated successfully.</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {template.allowFreeDownload !== false && (
                <button
                  onClick={handleDownload}
                  className="bg-green-600 text-white px-8 py-3 rounded-lg hover:bg-green-700 flex items-center justify-center"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Document
                </button>
              )}
              <button
                onClick={handleContinueToOrder}
                className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 flex items-center justify-center"
              >
                Continue to Order
                <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            <button
              onClick={() => router.push('/templates')}
              className="mt-6 text-gray-600 hover:text-gray-800"
            >
              ← Back to Templates
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show form step (default)
  return (
    <>
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Link
            href="/templates"
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            ← Back to Templates
          </Link>
        </div>

        {/* Template Header */}
        <div className="bg-white shadow rounded-lg mb-6">
          <div className="px-6 py-4 border-b border-gray-200">
            <h1 className="text-2xl font-bold text-gray-900">{template.name}</h1>
            <p className="mt-1 text-sm text-gray-600">{template.description}</p>
            <div className="mt-2 flex items-center flex-wrap gap-2">
              <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                {template.category}
              </span>
              {template.isPaid && (template.price ?? 0) > 0 ? (
                <span className="bg-orange-100 text-orange-800 text-xs px-3 py-1 rounded font-semibold">
                  ₹{template.price}
                </span>
              ) : (
                <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded font-medium">
                  Free Template
                </span>
              )}
              {template.isPaid && template.allowFreeDownload === false && (
                <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded">
                  Download requires payment
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-2xl mx-auto">
          {/* Form Section */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <MemoIcon size={20} className="w-5 h-5 mr-2" />
                Fill Template Form
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Fill out the form below and download your personalized document
              </p>
            </div>

            <div className="p-6">
              {!isAuthenticated && authStatus !== 'loading' && (
                <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800 mb-3 flex items-center gap-2">
                    <WarningIcon size={18} className="w-4.5 h-4.5" />
                    <strong>Sign in required:</strong> You need to sign in to generate documents.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setAuthMode('signin'); setShowAuthModal(true); }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                      Sign In
                    </button>
                    <button
                      onClick={() => { setAuthMode('signup'); setShowAuthModal(true); }}
                      className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors text-sm font-medium"
                    >
                      Create Account
                    </button>
                  </div>
                </div>
              )}

              {(error || redirectCountdown !== null) && (
                <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
                  <div className="flex">
                    <div className="ml-3">
                      {error && (
                        <>
                          <h3 className="text-sm font-medium text-red-800">Error</h3>
                          <div className="mt-2 text-sm text-red-700">{error}</div>
                        </>
                      )}
                      {redirectCountdown !== null && (
                        <div className="mt-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded p-3">
                          {redirectMessage || 'Redirecting'} in {redirectCountdown}s... Please wait while your download starts.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}


              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-4">
                  {template.formSchema && Array.isArray(template.formSchema) ? (
                    // Use formSchema if available
                    (() => {
                      console.log('[RENDER] Rendering formSchema fields');
                      console.log('[RENDER] FormSchema count:', template.formSchema.length);
                      console.log('[RENDER] FormSchema keys to render:', template.formSchema.map(f => f.key));
                      return template.formSchema.map((field) => {
                        console.log(`[RENDER] Rendering field: ${field.key} (label: ${field.label})`);
                        return (
                          <div key={field.key} className={field.type === 'textarea' ? 'col-span-2' : ''}>
                            <label htmlFor={field.key} className="block text-sm font-medium text-gray-700">
                              {field.label}
                              {field.required && <span className="text-red-500 ml-1">*</span>}
                            </label>
                            {renderFormField(field)}
                          </div>
                        );
                      });
                    })()
                  ) : template.placeholders && Array.isArray(template.placeholders) ? (
                    // Fallback: use placeholders to create form fields
                    template.placeholders.map((placeholder) => (
                      <div key={placeholder}>
                        <label htmlFor={placeholder} className="block text-sm font-medium text-gray-700">
                          {placeholder.charAt(0).toUpperCase() + placeholder.slice(1)}
                          <span className="text-red-500 ml-1">*</span>
                        </label>
                        <input
                          type="text"
                          id={placeholder}
                          value={formData[placeholder] || ''}
                          onChange={(e) => handleInputChange(placeholder, e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder={`Enter ${placeholder}`}
                          required
                        />
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-gray-500 py-8">
                      No form fields available for this template.
                    </div>
                  )}
                </div>

                <div className="flex justify-end space-x-4 pt-4 border-t border-gray-200">
                  <Link
                    href="/templates"
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Cancel
                  </Link>
                  <button
                    type={isAuthenticated ? 'submit' : 'button'}
                    onClick={!isAuthenticated ? (e: React.MouseEvent) => { e.preventDefault(); setAuthMode('signin'); setShowAuthModal(true); } : undefined}
                    disabled={isSubmitting}
                    className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${isAuthenticated ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500' : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'} focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {!isAuthenticated ? (
                      <>
                        <LockIcon size={16} className="w-4 h-4 mr-2" />
                        Sign In to Generate
                      </>
                    ) : isSubmitting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Generating...
                      </>
                    ) : (
                      'Generate Document'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>

        </div>
      </div>
    </div>

    {/* Inline Auth Modal */}
    <InlineAuthModal
      isOpen={showAuthModal}
      onClose={() => setShowAuthModal(false)}
      onAuthSuccess={() => {
        setShowAuthModal(false);
      }}
      initialMode={authMode}
    />
    </>
  );
}