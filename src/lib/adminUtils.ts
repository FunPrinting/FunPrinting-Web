// Common admin utility functions
import { MicroscopeIcon, MemoIcon, ChartIcon, TrophyIcon, DocumentIcon } from '@/components/SocialIcons';
import React from 'react';

export const getStatusColor = (status: string) => {
  switch (status) {
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'processing':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'printing':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'printed':
      return 'bg-teal-100 text-teal-800 border-teal-300';
    case 'dispatched':
      return 'bg-purple-100 text-purple-800 border-purple-300';
    case 'delivered':
      return 'bg-green-100 text-green-800 border-green-300';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
};

export const getPaymentStatusColor = (status: string) => {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'failed':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'refunded':
      return 'bg-blue-100 text-blue-800 border border-blue-300';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
};

export const getOrderStatusColor = (status: string) => {
  switch (status) {
    case 'pending':
      return 'bg-gray-100 text-gray-800 border border-gray-300';
    case 'processing':
      return 'bg-orange-100 text-orange-800 border border-orange-300';
    case 'printing':
      return 'bg-gray-200 text-gray-900 border border-gray-400';
    case 'dispatched':
      return 'bg-black text-white border border-gray-800';
    case 'delivered':
      return 'bg-gray-800 text-white border border-gray-900';
    default:
      return 'bg-gray-100 text-gray-800 border border-gray-300';
  }
};

export const getOrderPaymentStatusColor = (status: string) => {
  switch (status) {
    case 'completed':
      return 'bg-gray-800 text-white border border-gray-900';
    case 'pending':
      return 'bg-gray-100 text-gray-800 border border-gray-300';
    case 'failed':
      return 'bg-black text-white border border-gray-800';
    case 'refunded':
      return 'bg-blue-100 text-blue-800 border border-blue-300';
    default:
      return 'bg-gray-100 text-gray-800 border border-gray-300';
  }
};

export const formatDate = (dateString: string, format: 'short' | 'long' = 'short') => {
  const date = new Date(dateString);

  if (format === 'long') {
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getDefaultExpectedDate = (createdAt: string) => {
  const orderDate = new Date(createdAt);
  const defaultDate = new Date(orderDate.getTime() + 24 * 60 * 60 * 1000); // Add 1 day
  return defaultDate.toISOString();
};

export const getCategoryIcon = (category: string): React.ComponentType<{ className?: string; size?: number }> => {
  switch (category) {
    case 'lab-manual':
      return MicroscopeIcon;
    case 'assignment':
      return MemoIcon;
    case 'report':
      return ChartIcon;
    case 'certificate':
      return TrophyIcon;
    default:
      return DocumentIcon;
  }
};

export const getCategoryColor = (category: string) => {
  switch (category) {
    case 'lab-manual':
      return 'bg-blue-100 text-blue-800';
    case 'assignment':
      return 'bg-green-100 text-green-800';
    case 'report':
      return 'bg-purple-100 text-purple-800';
    case 'certificate':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

// Common form input styling
export const formInputClasses = {
  base: "w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200",
  white: "w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white hover:bg-gray-50",
  disabled: "w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-gray-100 cursor-not-allowed"
};

// Common button styling
export const buttonClasses = {
  primary: "bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors",
  secondary: "bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors",
  success: "bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors",
  danger: "bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors",
  warning: "bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors",
  outline: "border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
};
