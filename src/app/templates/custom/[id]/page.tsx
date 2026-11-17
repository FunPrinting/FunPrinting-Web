'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { startTemplateCheckout } from '@/lib/payments/client';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  placeholders: string[];
  pdfUrl: string;
  wordUrl: string;
  isPaid?: boolean;
  price?: number;
  allowFreeDownload?: boolean;
}

interface FormField {
  id: string;
  name: string;
  label: string;
  type: string;
  placeholder: string;
  required: boolean;
  placeholderKey: string;
}

interface FormConfig {
  title: string;
  description: string;
  fields: FormField[];
  submitText: string;
  validation: {
    required: string[];
  };
}

type Step = 'filling' | 'payment' | 'complete';

export default function CustomTemplatePage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.id as string;

  const [template, setTemplate] = useState<Template | null>(null);
  const [formConfig, setFormConfig] = useState<FormConfig | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('filling');
  const [generatedPdfUrl, setGeneratedPdfUrl] = useState<string | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  useEffect(() => {
    if (templateId) {
      fetchTemplate();
    }
  }, [templateId]);

  const fetchTemplate = async () => {
    try {
      setIsLoading(true);
      
      // Fetch template details
      const templateResponse = await fetch(`/api/templates/${templateId}`);
      if (!templateResponse.ok) {
        throw new Error('Template not found');
      }
      
      const templateData = await templateResponse.json();
      setTemplate(templateData.template);
      
      // Generate dynamic form based on placeholders
      const formResponse = await fetch('/api/generate-dynamic-form', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          placeholders: templateData.template.placeholders
        })
      });
      
      if (!formResponse.ok) {
        throw new Error('Failed to generate form');
      }
      
      const formData = await formResponse.json();
      setFormConfig(formData.formConfig);
      
    } catch (error) {
      console.error('Error fetching template:', error);
      setError('Failed to load template');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (fieldName: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  const validateForm = (): boolean => {
    if (!formConfig) return false;
    
    for (const fieldName of formConfig.validation.required) {
      if (!formData[fieldName] || formData[fieldName].trim() === '') {
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      alert('Please fill in all required fields');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // Generate custom document
      const response = await fetch('/api/templates/generate-custom', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          templateId: templateId,
          formData: formData
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate document');
      }

      const result = await response.json();
      
      if (result.success) {
        setGeneratedPdfUrl(result.pdfUrl);
        
        // Check if template is paid
        if (template?.isPaid && (template.price ?? 0) > 0) {
          // Move to payment step
          setStep('payment');
        } else {
          // Free template - show options directly
          setStep('complete');
        }
      } else {
        throw new Error(result.error || 'Failed to generate document');
      }
      
    } catch (error) {
      console.error('Error generating document:', error);
      setError('Failed to generate document. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePayment = async () => {
    if (!template) return;
    setIsProcessingPayment(true);
    setError(null);
    try {
      // Redirects to Razorpay; the status page continues to document generation
      await startTemplateCheckout(templateId, formData as Record<string, unknown>);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Payment failed. Please try again.');
      setIsProcessingPayment(false);
    }
  };

  const handleDownload = () => {
    if (!generatedPdfUrl) return;
    
    // Create a temporary link and trigger download
    const link = document.createElement('a');
    link.href = generatedPdfUrl;
    link.download = `${template?.name || 'document'}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleContinueToOrder = () => {
    if (!generatedPdfUrl || !template) return;
    
    // Store order data in sessionStorage for the order page
    const orderData = {
      templateId: templateId,
      templateName: template.name,
      pdfUrl: generatedPdfUrl,
      customerData: formData,
      isTemplateDocument: true
    };
    
    sessionStorage.setItem('pendingTemplateDocument', JSON.stringify(orderData));
    
    // Redirect to order page
    router.push('/order');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading template...</p>
        </div>
      </div>
    );
  }

  if (error || !template || !formConfig) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 text-6xl mb-4">❌</div>
          <h2 className="text-2xl font-bold text-red-800 mb-2">Error</h2>
          <p className="text-red-700 mb-4">{error || 'Template not found'}</p>
          <button
            onClick={() => router.push('/templates')}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
          >
            Back to Templates
          </button>
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

            <div className="flex gap-4 justify-center">
              <button
                onClick={() => router.push('/templates')}
                className="bg-gray-300 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handlePayment}
                disabled={isProcessingPayment}
                className="bg-blue-600 text-white px-8 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {isProcessingPayment ? (
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
              <button
                onClick={handleDownload}
                className="bg-green-600 text-white px-8 py-3 rounded-lg hover:bg-green-700 flex items-center justify-center"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Document
              </button>
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
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Template Header */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{template.name}</h1>
          <p className="text-gray-600 mb-4">{template.description}</p>
          <div className="flex items-center flex-wrap gap-2 text-sm text-gray-500">
            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
              {template.category}
            </span>
            <span>{formConfig.fields.length} fields to fill</span>
            {template.isPaid && (template.price ?? 0) > 0 ? (
              <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded font-semibold text-base">
                ₹{template.price}
              </span>
            ) : (
              <span className="bg-green-100 text-green-800 px-2 py-1 rounded font-medium">
                Free Template
              </span>
            )}
            {template.isPaid && template.allowFreeDownload === false && (
              <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs">
                Download requires payment
              </span>
            )}
          </div>
        </div>

        {/* Form */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{formConfig.title}</h2>
            <p className="text-gray-600">{formConfig.description}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {formConfig.fields.map((field) => (
              <div key={field.id}>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                
                {field.type === 'textarea' ? (
                  <textarea
                    value={formData[field.name] || ''}
                    onChange={(e) => handleInputChange(field.name, e.target.value)}
                    placeholder={field.placeholder}
                    required={field.required}
                    rows={4}
                    className="form-input"
                  />
                ) : (
                  <input
                    type={field.type}
                    value={formData[field.name] || ''}
                    onChange={(e) => handleInputChange(field.name, e.target.value)}
                    placeholder={field.placeholder}
                    required={field.required}
                    className="form-input"
                  />
                )}
              </div>
            ))}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-700">{error}</p>
              </div>
            )}

            <div className="flex justify-between items-center pt-6">
              <button
                type="button"
                onClick={() => router.push('/templates')}
                className="bg-gray-300 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-400"
              >
                ← Back to Templates
              </button>
              
              <button
                type="submit"
                disabled={!validateForm() || isGenerating}
                className="bg-blue-600 text-white px-8 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {isGenerating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Generating...
                  </>
                ) : (
                  formConfig.submitText
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}