'use client';

import Image from 'next/image';
import {
  ChartIcon,
  DocumentIcon,
  FolderIcon,
  CheckIcon,
  TruckIcon,
  LocationIcon,
  ImageIcon,
  MemoIcon,
  PaperclipIcon,
  PrinterIcon,
  UserIcon,
} from '@/components/SocialIcons';
import { getStatusColor, getPaymentStatusColor, formatDate, getDefaultExpectedDate } from '@/lib/adminUtils';

type OrderDetailMode = 'admin' | 'user';

export interface OrderDetailViewProps {
  order: any;
  mode?: OrderDetailMode;
  selectedFileIndex: number;
  setSelectedFileIndex: (index: number) => void;
  pdfLoaded: boolean;
  setPdfLoaded: (loaded: boolean) => void;
  isUpdating?: boolean;
  isPrinting?: boolean;
  isShipping?: boolean;
  onUpdateStatus?: (newStatus: string) => void;
  onSendToPrintQueue?: () => void;
  onDeleteOrder?: () => void;
  onShipOrder?: () => void;
  onMarkAsPrinted?: () => void;
}

// Helper function to detect file type from URL or filename
function getFileTypeFromURL(url: string, fileName: string): string {
  const fileNameLower = fileName.toLowerCase();
  const urlLower = url.toLowerCase();

  const fileNameMatch = fileNameLower.match(/\.([a-z0-9]+)$/);
  if (fileNameMatch) {
    const ext = fileNameMatch[1];
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      rtf: 'application/rtf',
    };

    if (mimeTypes[ext]) {
      return mimeTypes[ext];
    }
  }

  const urlMatch = urlLower.match(/\.([a-z0-9]+)(\?|$)/);
  if (urlMatch) {
    const ext = urlMatch[1];
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    if (mimeTypes[ext]) {
      return mimeTypes[ext];
    }
  }

  return 'application/octet-stream';
}

export function OrderDetailView(props: OrderDetailViewProps) {
  const {
    order,
    mode = 'admin',
    selectedFileIndex,
    setSelectedFileIndex,
    pdfLoaded,
    setPdfLoaded,
    isUpdating = false,
    isPrinting = false,
    isShipping = false,
    onUpdateStatus,
    onSendToPrintQueue,
    onDeleteOrder,
    onShipOrder,
    onMarkAsPrinted,
  } = props;

  if (!order) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Left Column - Order Details */}
      <div className="space-y-6">
        {/* Order Summary */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <DocumentIcon size={24} className="w-6 h-6" />
            Order Summary
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Order ID:</span>
              <span className="font-mono font-bold text-gray-900">{order.orderId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Order Time:</span>
              <span className="font-medium text-gray-900">
                {order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Order Type:</span>
              <span className="font-medium">
                {order.orderType === 'file' ? 'File Upload' : 'Template Generated'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Page Size:</span>
              <span className="font-medium">{order.printingOptions?.pageSize}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Color:</span>
              <span className="font-medium">
                {order.printingOptions?.color === 'color'
                  ? 'Color'
                  : order.printingOptions?.color === 'bw'
                    ? 'Black & White'
                    : 'Mixed'}
              </span>
            </div>

            {/* Mixed color details and preview – identical to admin view */}
            {(() => {
              console.log('🔍 DEBUG - Order printingOptions:', order.printingOptions);
              console.log('🔍 DEBUG - pageColors:', order.printingOptions?.pageColors);
              console.log('🔍 DEBUG - fileOptions:', (order.printingOptions as any)?.fileOptions);
              console.log('🔍 DEBUG - fileURLs length:', order.fileURLs?.length || 0);
              return null;
            })()}

            {(() => {
              const getDisplayPageColors = () => {
                const fileOptions = (order.printingOptions as any)?.fileOptions;
                if (Array.isArray(fileOptions) && fileOptions.length > 0) {
                  const targetFileIndex = selectedFileIndex || 0;
                  const targetFile = fileOptions[targetFileIndex];

                  if (targetFile?.pageColors) {
                    return targetFile.pageColors;
                  }
                }

                return order.printingOptions?.pageColors;
              };

              const displayPageColors = getDisplayPageColors();
              const colorPages = displayPageColors?.colorPages || [];
              const bwPages = displayPageColors?.bwPages || [];

              console.log('🔍 DEBUG - Display page colors:', displayPageColors);
              console.log('🔍 DEBUG - Color pages:', colorPages);
              console.log('🔍 DEBUG - B&W pages:', bwPages);

              return displayPageColors && (colorPages.length > 0 || bwPages.length > 0);
            })() && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-2">
                  <div className="font-medium text-green-800 mb-3">🎨 Mixed Color Printing Details</div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                      <span className="text-gray-700">Color Pages:</span>
                      <span className="font-medium text-green-600">
                        {(() => {
                          const fileOptions = (order.printingOptions as any)?.fileOptions;
                          let colorPages: number[] = [];

                          if (Array.isArray(fileOptions) && fileOptions.length > 0) {
                            const targetFileIndex = selectedFileIndex || 0;
                            colorPages = fileOptions[targetFileIndex]?.pageColors?.colorPages || [];
                          } else {
                            const pageColors = order.printingOptions?.pageColors;
                            if (Array.isArray(pageColors)) {
                              colorPages = pageColors[selectedFileIndex || 0]?.colorPages || [];
                            } else if (pageColors) {
                              colorPages = pageColors.colorPages || [];
                            }
                          }

                          return `${colorPages.length} pages`;
                        })()}
                      </span>
                    </div>
                    <div className="text-sm text-green-700 ml-5 bg-white px-2 py-1 rounded border">
                      [
                      {(() => {
                        const fileOptions = (order.printingOptions as any)?.fileOptions;
                        let colorPages: number[] = [];

                        if (Array.isArray(fileOptions) && fileOptions.length > 0) {
                          const targetFileIndex = selectedFileIndex || 0;
                          colorPages = fileOptions[targetFileIndex]?.pageColors?.colorPages || [];
                        } else {
                          const pageColors = order.printingOptions?.pageColors;
                          if (Array.isArray(pageColors)) {
                            colorPages = pageColors[selectedFileIndex || 0]?.colorPages || [];
                          } else if (pageColors) {
                            colorPages = pageColors.colorPages || [];
                          }
                        }

                        return colorPages.length > 0 ? colorPages.join(', ') : 'None';
                      })()}
                      ]
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 bg-gray-500 rounded-full"></span>
                      <span className="text-gray-700">B&W Pages:</span>
                      <span className="font-medium text-gray-600">
                        {(() => {
                          const fileOptions = (order.printingOptions as any)?.fileOptions;
                          let bwPages: number[] = [];

                          if (Array.isArray(fileOptions) && fileOptions.length > 0) {
                            const targetFileIndex = selectedFileIndex || 0;
                            bwPages = fileOptions[targetFileIndex]?.pageColors?.bwPages || [];
                          } else {
                            const pageColors = order.printingOptions?.pageColors;
                            if (Array.isArray(pageColors)) {
                              bwPages = pageColors[selectedFileIndex || 0]?.bwPages || [];
                            } else if (pageColors) {
                              bwPages = pageColors.bwPages || [];
                            }
                          }

                          return `${bwPages.length} pages`;
                        })()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 ml-5 bg-white px-2 py-1 rounded border">
                      [
                      {(() => {
                        const fileOptions = (order.printingOptions as any)?.fileOptions;
                        let bwPages: number[] = [];

                        if (Array.isArray(fileOptions) && fileOptions.length > 0) {
                          const targetFileIndex = selectedFileIndex || 0;
                          bwPages = fileOptions[targetFileIndex]?.pageColors?.bwPages || [];
                        } else {
                          const pageColors = order.printingOptions?.pageColors;
                          if (Array.isArray(pageColors)) {
                            bwPages = pageColors[selectedFileIndex || 0]?.bwPages || [];
                          } else if (pageColors) {
                            bwPages = pageColors.bwPages || [];
                          }
                        }

                        return bwPages.length > 0 ? bwPages.join(', ') : 'None';
                      })()}
                      ]
                    </div>

                    {order.printingOptions?.pageCount && order.printingOptions.pageCount > 0 && (
                      <div className="mt-3 pt-3 border-t border-green-300">
                        <div className="text-xs font-medium text-green-800 mb-2">
                          Page Preview ({order.printingOptions.pageCount} total pages)
                        </div>
                        <div className="flex flex-wrap gap-1.5 p-2 bg-white rounded border border-green-200 max-h-32 overflow-y-auto">
                          {Array.from({ length: order.printingOptions.pageCount }, (_, i) => i + 1).map(
                            (pageNum) => {
                              const fileOptions = (order.printingOptions as any)?.fileOptions;
                              let colorPages: number[] = [];
                              let bwPages: number[] = [];

                              if (Array.isArray(fileOptions) && fileOptions.length > 0) {
                                const targetFileIndex = selectedFileIndex || 0;
                                colorPages = fileOptions[targetFileIndex]?.pageColors?.colorPages || [];
                                bwPages = fileOptions[targetFileIndex]?.pageColors?.bwPages || [];
                              } else {
                                const pageColors = order.printingOptions?.pageColors;
                                if (Array.isArray(pageColors)) {
                                  const targetPageColors = pageColors[selectedFileIndex || 0];
                                  colorPages = targetPageColors?.colorPages || [];
                                  bwPages = targetPageColors?.bwPages || [];
                                } else if (pageColors) {
                                  colorPages = pageColors.colorPages || [];
                                  bwPages = pageColors.bwPages || [];
                                }
                              }

                              const isColor = colorPages.includes(pageNum);
                              const isBw = bwPages.includes(pageNum);
                              return (
                                <div
                                  key={pageNum}
                                  className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${isColor
                                    ? 'bg-gradient-to-r from-green-400 to-green-600 text-white shadow-sm'
                                    : isBw
                                      ? 'bg-gray-300 text-gray-800'
                                      : 'bg-gray-100 text-gray-500 border border-gray-300'
                                    }`}
                                  title={
                                    isColor
                                      ? `Page ${pageNum} - Color`
                                      : isBw
                                        ? `Page ${pageNum} - Black & White`
                                        : `Page ${pageNum} - Not specified`
                                  }
                                >
                                  {pageNum}
                                </div>
                              );
                            },
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            <div className="flex justify-between">
              <span className="text-gray-600">Sided:</span>
              <span className="font-medium">
                {order.printingOptions?.sided === 'double' ? 'Double-sided' : 'Single-sided'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Copies:</span>
              <span className="font-medium">{order.printingOptions?.copies}</span>
            </div>
            {order.printingOptions?.pageCount && (
              <div className="flex justify-between">
                <span className="text-gray-600">Pages:</span>
                <span className="font-medium">{order.printingOptions.pageCount}</span>
              </div>
            )}
            {(order.printingOptions?.serviceOption || (order.printingOptions?.serviceOptions && order.printingOptions.serviceOptions.length > 0)) && (
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Service Type:</span>
                <span className="font-medium">
                  {order.printingOptions?.serviceOptions && order.printingOptions.serviceOptions.length > 0
                    ? order.printingOptions.serviceOptions.map((s: string) => (
                      <span key={s} className="inline-block ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 border border-indigo-200">
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </span>
                    ))
                    : order.printingOptions?.serviceOption
                      ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 border border-indigo-200">
                        {order.printingOptions.serviceOption.charAt(0).toUpperCase() + order.printingOptions.serviceOption.slice(1)}
                      </span>
                      : 'N/A'}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-600">Total Amount:</span>
              <span className="text-xl font-bold text-gray-900">₹{order.amount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Expected Delivery:</span>
              <span className="font-medium text-blue-600">
                {order.expectedDate ? (
                  formatDate(order.expectedDate.toString(), 'long')
                ) : (
                  <span className="text-orange-600">
                    {formatDate(getDefaultExpectedDate(order.createdAt), 'long')} (Default)
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Customer Information */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <UserIcon size={24} className="w-6 h-6" />
            Customer Information
          </h2>
          <div className="space-y-3">
            <div>
              <span className="text-gray-600">Name:</span>
              <span className="ml-2 font-medium">
                {order.customerInfo?.name || order.studentInfo?.name || 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-gray-600">Phone:</span>
              <span className="ml-2 font-medium">
                {order.customerInfo?.phone || order.studentInfo?.phone || 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-gray-600">Email:</span>
              <span className="ml-2 font-medium">
                {order.customerInfo?.email || order.studentInfo?.email || 'N/A'}
              </span>
            </div>
          </div>
        </div>

        {/* Partner Information */}
        {order.partnerInfo && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <PrinterIcon size={24} className="w-6 h-6" />
              Print Shop Details
            </h2>
            <div className="space-y-3">
              <div>
                <span className="text-gray-600">Shop Name:</span>
                <span className="ml-2 font-medium text-blue-600">{order.partnerInfo.businessName}</span>
              </div>
              {order.deliveryOption?.partnerDeliveryPoint && (
                <div>
                  <span className="text-gray-600">Delivery Point:</span>
                  <span className="ml-2 font-medium">{order.deliveryOption.partnerDeliveryPoint}</span>
                </div>
              )}
              {(order.partnerInfo.phoneNumbers?.length > 0 || order.partnerInfo.phone) && (
                <div>
                  <span className="text-gray-600">Shop Phone:</span>
                  <span className="ml-2 font-medium">
                    {order.partnerInfo.phoneNumbers?.length > 0 
                      ? order.partnerInfo.phoneNumbers.join(', ')
                      : order.partnerInfo.phone}
                  </span>
                </div>
              )}
              {(() => {
                const selectedDeliveryPoint = order.partnerInfo.deliveryPoints?.find(
                  (dp: any) => dp.name === order.deliveryOption?.partnerDeliveryPoint
                );
                if (selectedDeliveryPoint?.contactNumber) {
                  return (
                    <div>
                      <span className="text-gray-600">Delivery Point Contact:</span>
                      <span className="ml-2 font-medium text-green-700">{selectedDeliveryPoint.contactNumber}</span>
                    </div>
                  );
                }
                return null;
              })()}
              {order.partnerInfo.address && (
                <div>
                  <span className="text-gray-600">Address:</span>
                  <span className="ml-2 font-medium">
                    {typeof order.partnerInfo.address === 'string'
                      ? order.partnerInfo.address
                      : [
                          order.partnerInfo.address.street,
                          order.partnerInfo.address.city,
                          order.partnerInfo.address.state,
                          order.partnerInfo.address.zipCode
                        ]
                          .filter(Boolean)
                          .join(', ')}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Delivery Information */}
        {order.deliveryOption && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <TruckIcon size={24} className="w-6 h-6" />
              Delivery Information
            </h2>
            <div className="space-y-3">
              <div>
                <span className="text-gray-600">Type:</span>
                <span
                  className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${order.deliveryOption.type === 'pickup'
                    ? 'bg-green-100 text-green-800 border border-green-300'
                    : 'bg-blue-100 text-blue-800 border border-blue-300'
                    }`}
                >
                  {order.deliveryOption.type === 'pickup' ? 'Pickup' : 'Delivery'}
                </span>
              </div>
              {order.deliveryOption.type === 'pickup' && order.deliveryOption.pickupLocation && (
                <div className="space-y-2">
                  <div>
                    <span className="text-gray-600">Pickup Location:</span>
                    <span className="ml-2 font-medium">{order.deliveryOption.pickupLocation.name}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Address:</span>
                    <span className="ml-2 font-medium">
                      {order.deliveryOption.pickupLocation.address}
                    </span>
                  </div>
                  {order.deliveryOption.pickupLocation.contactPerson && (
                    <div>
                      <span className="text-gray-600">Contact Person:</span>
                      <span className="ml-2 font-medium">
                        {order.deliveryOption.pickupLocation.contactPerson}
                      </span>
                    </div>
                  )}
                  {order.deliveryOption.pickupLocation.contactPhone && (
                    <div>
                      <span className="text-gray-600">Contact Phone:</span>
                      <span className="ml-2 font-medium">
                        {order.deliveryOption.pickupLocation.contactPhone}
                      </span>
                    </div>
                  )}
                  {order.deliveryOption.pickupLocation.operatingHours && (
                    <div>
                      <span className="text-gray-600">Operating Hours:</span>
                      <span className="ml-2 font-medium">
                        {order.deliveryOption.pickupLocation.operatingHours}
                      </span>
                    </div>
                  )}
                  {order.deliveryOption.pickupLocation.gmapLink && (
                    <div>
                      <a
                        href={order.deliveryOption.pickupLocation.gmapLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 underline text-sm"
                      >
                        <span className="flex items-center gap-1">
                          <LocationIcon size={16} className="w-4 h-4" />
                          View on Google Maps
                        </span>
                      </a>
                    </div>
                  )}
                </div>
              )}
              {order.deliveryOption.type === 'delivery' && order.deliveryOption.deliveryCharge && (
                <div>
                  <span className="text-gray-600">Delivery Charge:</span>
                  <span className="ml-2 font-medium">₹{order.deliveryOption.deliveryCharge}</span>
                </div>
              )}
              {order.deliveryOption.type === 'delivery' && (order.deliveryOption.address || order.deliveryOption.flatBuilding) && (
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-2">
                  <p className="text-sm font-semibold text-gray-800">📍 Delivery Address</p>
                  {(order.deliveryOption.recipientName || order.deliveryOption.recipientPhone) && (
                    <p className="text-sm text-gray-700 font-medium">
                      {order.deliveryOption.recipientName}
                      {order.deliveryOption.recipientPhone && (
                        <span className="text-gray-500 ml-2">📞 {order.deliveryOption.recipientPhone}</span>
                      )}
                    </p>
                  )}
                  <p className="text-sm text-gray-700">
                    {order.deliveryOption.flatBuilding && <>{order.deliveryOption.flatBuilding}, </>}
                    {order.deliveryOption.address}
                  </p>
                  {order.deliveryOption.landmark && (
                    <p className="text-sm text-gray-500">Landmark: {order.deliveryOption.landmark}</p>
                  )}
                  <p className="text-sm text-gray-700">
                    {order.deliveryOption.city}
                    {order.deliveryOption.state && `, ${order.deliveryOption.state}`}
                    {order.deliveryOption.pinCode && ` - ${order.deliveryOption.pinCode}`}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Shiprocket Shipping & Tracking */}
        {order.deliveryOption?.type === 'delivery' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
              📦 Shipping & Tracking
            </h2>

            {order.shiprocket?.awbCode ? (
              <div className="space-y-4">
                {/* Tracking Info */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
                    <span className="font-medium text-green-800">Shipped via {order.shiprocket.courierName || 'Courier'}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-600">AWB Number:</span>
                      <span className="ml-2 font-mono font-medium text-gray-900">{order.shiprocket.awbCode}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Courier:</span>
                      <span className="ml-2 font-medium text-gray-900">{order.shiprocket.courierName || 'N/A'}</span>
                    </div>
                    {order.shiprocket.status && (
                      <div>
                        <span className="text-gray-600">Status:</span>
                        <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {order.shiprocket.status}
                        </span>
                      </div>
                    )}
                    {order.shiprocket.lastTrackedAt && (
                      <div>
                        <span className="text-gray-600">Last Updated:</span>
                        <span className="ml-2 text-gray-500 text-xs">
                          {formatDate(order.shiprocket.lastTrackedAt.toString(), 'long')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tracking Progress Bar */}
                <div className="flex items-center justify-between px-2">
                  {['Printed', 'Shipped', 'In Transit', 'Delivered'].map((step, idx) => {
                    const statusMap: Record<string, number> = {
                      'SHIPPED': 1, 'NEW': 1, 'PICKUP_SCHEDULED': 1,
                      'IN TRANSIT': 2, 'OUT_FOR_DELIVERY': 2, 'REACHED_AT_DESTINATION_HUB': 2,
                      'DELIVERED': 3,
                    };
                    const currentStep = statusMap[order.shiprocket?.status || ''] ?? 1;
                    const isCompleted = idx <= currentStep;
                    const isCurrent = idx === currentStep;
                    return (
                      <div key={step} className="flex flex-col items-center flex-1">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold mb-1 transition-all ${isCompleted
                          ? isCurrent
                            ? 'bg-blue-600 text-white ring-4 ring-blue-200'
                            : 'bg-green-600 text-white'
                          : 'bg-gray-200 text-gray-500'
                          }`}>
                          {isCompleted && !isCurrent ? '✓' : idx + 1}
                        </div>
                        <span className={`text-xs text-center ${isCompleted ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                          {step}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Track on Shiprocket Link */}
                {order.shiprocket.trackingUrl && (
                  <a
                    href={order.shiprocket.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                  >
                    🔗 Track on Shiprocket
                  </a>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-gray-500 text-sm">This order has not been shipped yet.</p>
                {/* Ship button — admin only */}
                {mode === 'admin' && onShipOrder && (
                  <button
                    onClick={onShipOrder}
                    disabled={isShipping || order.paymentStatus !== 'completed'}
                    className="w-full bg-purple-600 text-white px-4 py-2.5 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
                  >
                    <TruckIcon size={18} className="w-4.5 h-4.5" />
                    {isShipping ? 'Shipping via Shiprocket...' : '🚀 Ship via Shiprocket'}
                  </button>
                )}
                {mode === 'admin' && order.paymentStatus !== 'completed' && (
                  <p className="text-xs text-orange-600">⚠️ Payment must be completed before shipping.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Status Information */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <ChartIcon size={20} className="w-5 h-5" />
            Status Information
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Order Status:</span>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                  order.orderStatus,
                )}`}
              >
                {order.orderStatus
                  ? order.orderStatus.charAt(0).toUpperCase() + order.orderStatus.slice(1)
                  : 'Unknown'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Payment Status:</span>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${getPaymentStatusColor(
                  order.paymentStatus,
                )}`}
              >
                Payment{' '}
                {order.paymentStatus
                  ? order.paymentStatus.charAt(0).toUpperCase() + order.paymentStatus.slice(1)
                  : 'Unknown'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column - Document Preview and (optionally) Quick Actions */}
      <div className="space-y-6">
        {/* Document Preview */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <DocumentIcon size={20} className="w-5 h-5" />
            Document Preview
          </h2>

          {order.orderType === 'file' &&
            ((order.fileURLs && Array.isArray(order.fileURLs) && order.fileURLs.length > 0) ||
              order.fileURL) ? (
            <div className="space-y-4">
              {/* File list (for multiple files) */}
              {order.fileURLs && Array.isArray(order.fileURLs) && order.fileURLs.length > 0 ? (
                <>
                  <div className="flex items-center justify-between mb-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-gray-900 flex items-center gap-2">
                        <FolderIcon size={20} className="w-5 h-5" />
                        Files in this Order
                      </span>
                      <span className="px-2.5 py-1 bg-blue-600 text-white text-xs font-bold rounded-full">
                        {(order.fileURLs || [order.fileURL]).filter(Boolean).length} {(order.fileURLs || [order.fileURL]).filter(Boolean).length === 1 ? 'file' : 'files'}
                      </span>
                    </div>
                    <span className="text-xs text-gray-600">
                      Click a file to preview • Download individually
                    </span>
                  </div>

                  <div className="space-y-2 mb-4 max-h-64 overflow-y-auto border-2 border-gray-300 rounded-lg p-3 bg-white shadow-sm">
                    {(order.fileURLs || [order.fileURL]).filter(Boolean).map((fileURL: string, idx: number) => {
                      const fileName =
                        order.originalFileNames?.[idx] || `File ${idx + 1}`;
                      const fileType =
                        order.fileTypes?.[idx] ||
                        (idx === 0 ? order.fileType : undefined) ||
                        getFileTypeFromURL(fileURL, fileName);
                      const isImage = fileType.startsWith('image/');
                      const isPDF = fileType === 'application/pdf';
                      const isDoc = fileType.includes('word') || fileType.includes('document');
                      const fileOpt = Array.isArray((order.printingOptions as any)?.fileOptions)
                        ? (order.printingOptions as any).fileOptions[idx]
                        : undefined;
                      const modeValue = fileOpt?.color || order.printingOptions?.color;
                      const fileServiceType = Array.isArray(order.printingOptions?.serviceOptions) && order.printingOptions.serviceOptions.length > idx
                        ? order.printingOptions.serviceOptions[idx]
                        : order.printingOptions?.serviceOption || null;

                      const getFileIcon = () => {
                        if (isImage) return <ImageIcon size={20} className="w-5 h-5" />;
                        if (isPDF) return <DocumentIcon size={20} className="w-5 h-5" />;
                        if (isDoc) return <MemoIcon size={20} className="w-5 h-5" />;
                        return <PaperclipIcon size={20} className="w-5 h-5" />;
                      };

                      return (
                        <div
                          key={idx}
                          className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-all ${selectedFileIndex === idx
                            ? 'bg-blue-50 border-blue-400 shadow-sm'
                            : 'bg-white border-gray-300 hover:border-gray-400 hover:shadow-sm'
                            }`}
                          onClick={() => {
                            setSelectedFileIndex(idx);
                            setPdfLoaded(false);
                          }}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="flex items-center" title={fileType}>
                              {getFileIcon()}
                            </span>
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="text-sm font-medium text-gray-900 truncate">
                                {fileName}
                              </span>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-gray-500">
                                  {isImage
                                    ? 'Image'
                                    : isPDF
                                      ? 'PDF'
                                      : isDoc
                                        ? 'Document'
                                        : 'File'}{' '}
                                  • #{idx + 1}
                                </span>
                                <span
                                  className={`text-[10px] px-2 py-0.5 rounded-full border ${modeValue === 'mixed'
                                    ? 'bg-purple-50 text-purple-700 border-purple-200'
                                    : modeValue === 'color'
                                      ? 'bg-green-50 text-green-700 border-green-200'
                                      : 'bg-gray-100 text-gray-700 border-gray-200'
                                    }`}
                                  title={
                                    modeValue === 'mixed'
                                      ? 'Some pages color, some B&W'
                                      : modeValue === 'color'
                                        ? 'All pages color'
                                        : 'All pages B&W'
                                  }
                                >
                                  {modeValue === 'mixed'
                                    ? 'Mixed'
                                    : modeValue === 'color'
                                      ? 'Color'
                                      : 'B&W'}
                                </span>
                                {fileServiceType && (
                                  <span
                                    className="text-[10px] px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200"
                                    title={`Service: ${fileServiceType.charAt(0).toUpperCase() + fileServiceType.slice(1)}`}
                                  >
                                    {fileServiceType.charAt(0).toUpperCase() + fileServiceType.slice(1)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <a
                            href={`/api/admin/pdf-viewer?url=${encodeURIComponent(
                              fileURL,
                            )}&orderId=${order.orderId}&filename=${fileName}`}
                            className="bg-black text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-gray-800 transition-colors ml-2 flex-shrink-0"
                            onClick={(e) => e.stopPropagation()}
                            title={`Download ${fileName}`}
                          >
                            Download
                          </a>
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">
                        Preview:{' '}
                        {order.originalFileNames?.[selectedFileIndex] ||
                          `File ${selectedFileIndex + 1}`}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Original File</span>
                  {order.fileURL && (
                    <a
                      href={`/api/admin/pdf-viewer?url=${encodeURIComponent(
                        order.fileURL,
                      )}&orderId=${order.orderId}&filename=${order.originalFileName || 'document'
                        }`}
                      className="bg-black text-white px-3 py-1 rounded text-sm hover:bg-gray-800 transition-colors"
                    >
                      Download File
                    </a>
                  )}
                </div>
              )}

              {/* File Preview */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-4">Document Preview</h3>
                <div
                  className={`border rounded-lg overflow-hidden ${order.printingOptions?.color === 'bw' ? 'grayscale' : ''
                    }`}
                >
                  {!pdfLoaded && (
                    <div className="h-96 bg-gray-100 flex items-center justify-center">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black mx-auto mb-4"></div>
                        <p className="text-gray-600">Loading preview...</p>
                        <button
                          onClick={() => setPdfLoaded(true)}
                          className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          Show Preview Anyway
                        </button>
                      </div>
                    </div>
                  )}

                  {(() => {
                    const currentFileURL =
                      order.fileURLs && order.fileURLs.length > 0
                        ? order.fileURLs[selectedFileIndex]
                        : order.fileURL;
                    const currentFileName =
                      order.originalFileNames && order.originalFileNames.length > 0
                        ? order.originalFileNames[selectedFileIndex]
                        : order.originalFileName || 'document';
                    let fileType: string;
                    if (order.fileURLs && order.fileURLs.length > 0) {
                      fileType =
                        order.fileTypes?.[selectedFileIndex] ||
                        (currentFileURL && currentFileName
                          ? getFileTypeFromURL(currentFileURL, currentFileName)
                          : 'application/octet-stream');
                    } else {
                      fileType =
                        order.fileType ||
                        (currentFileURL && currentFileName
                          ? getFileTypeFromURL(currentFileURL, currentFileName)
                          : 'application/octet-stream');
                    }
                    const isImage = fileType.startsWith('image/');
                    const isPDF = fileType === 'application/pdf';

                    if (!currentFileURL) {
                      return (
                        <div className="w-full h-96 flex items-center justify-center bg-gray-50">
                          <div className="text-center text-gray-500">
                            No file available for preview
                          </div>
                        </div>
                      );
                    }

                    if (isImage) {
                      return (
                        <Image
                          src={`/api/admin/pdf-viewer?url=${encodeURIComponent(
                            currentFileURL,
                          )}&orderId=${order.orderId}&filename=${currentFileName}`}
                          alt="Document preview"
                          width={800}
                          height={384}
                          className="w-full h-96 object-contain"
                          onLoad={() => setPdfLoaded(true)}
                          style={{ display: pdfLoaded ? 'block' : 'none' }}
                        />
                      );
                    }

                    if (isPDF) {
                      const iframeSrc = `/api/admin/pdf-viewer?url=${encodeURIComponent(
                        currentFileURL,
                      )}&orderId=${order.orderId}&filename=${encodeURIComponent(
                        currentFileName,
                      )}`;
                      console.log('📄 Rendering PDF iframe:', {
                        iframeSrc,
                        currentFileName,
                        fileType,
                      });

                      return (
                        <div className="relative w-full h-96">
                          <iframe
                            key={`${currentFileURL}-${selectedFileIndex}`}
                            src={iframeSrc}
                            className="w-full h-96 border-0"
                            onLoad={() => {
                              console.log('✅ PDF iframe onLoad event fired');
                              setPdfLoaded(true);
                            }}
                            onError={(e) => {
                              console.error('❌ PDF iframe failed to load:', e);
                              setPdfLoaded(true);
                            }}
                            style={{
                              opacity: pdfLoaded ? 1 : 0,
                              transition: 'opacity 0.3s',
                              position: 'relative',
                              zIndex: pdfLoaded ? 1 : 0,
                            }}
                            title="PDF Preview"
                            allow="fullscreen"
                          />
                          {!pdfLoaded && (
                            <div className="absolute inset-0 bg-gray-100 flex items-center justify-center z-10">
                              <div className="text-center">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black mx-auto mb-4"></div>
                                <p className="text-gray-600">Loading PDF preview...</p>
                                <p className="text-xs text-gray-500 mt-2">{currentFileName}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div className="w-full h-96 flex items-center justify-center bg-gray-50">
                        <div className="text-center">
                          <div className="flex justify-center mb-4">
                            <DocumentIcon size={64} className="w-16 h-16" />
                          </div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            {currentFileName}
                          </h3>
                          <p className="text-gray-600 mb-2">File Type: {fileType}</p>
                          <p className="text-gray-600 mb-4">
                            This file type cannot be previewed in the browser
                          </p>
                          <a
                            href={`/api/admin/pdf-viewer?url=${encodeURIComponent(
                              currentFileURL,
                            )}&orderId=${order.orderId}&filename=${currentFileName}`}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                          >
                            Download to View
                          </a>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          ) : order.orderType === 'template' && order.templateData?.generatedPDF ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Generated Template PDF</span>
                <a
                  href={order.templateData.generatedPDF}
                  className="bg-gray-800 text-white px-3 py-1 rounded text-sm hover:bg-black transition-colors"
                >
                  Download PDF
                </a>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-4">Document Preview</h3>
                <div className="border rounded-lg overflow-hidden">
                  <iframe
                    src={order.templateData.generatedPDF}
                    className="w-full h-96"
                    style={{ display: 'block' }}
                    title="Template PDF Preview"
                  />
                </div>
              </div>
              {order.templateData.formData && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="font-medium text-gray-900 mb-2">Template Data</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    {Object.entries(order.templateData.formData).map(([key, value]) => (
                      <div key={key}>
                        <span className="text-gray-600">{key}:</span>
                        <span className="ml-2 text-gray-900">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">No document available for preview</div>
          )}
        </div>

        {/* Quick Actions – admin-only */}
        {mode === 'admin' && onUpdateStatus && onSendToPrintQueue && onDeleteOrder && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">⚡ Quick Actions</h2>
            <div className="space-y-3">
              {(order.customerInfo?.phone || order.studentInfo?.phone) && (
                <a
                  href={`tel:${order.customerInfo?.phone || order.studentInfo?.phone}`}
                  className="w-full bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                  Call Customer
                </a>
              )}

              <button
                onClick={() => onUpdateStatus('processing')}
                disabled={order.orderStatus === 'processing' || isUpdating}
                className="w-full bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUpdating ? 'Updating...' : 'Mark as Processing'}
              </button>

              <button
                onClick={onSendToPrintQueue}
                disabled={
                  isPrinting ||
                  isUpdating ||
                  order.paymentStatus !== 'completed' ||
                  (!order.fileURL && (!order.fileURLs || order.fileURLs.length === 0))
                }
                className="w-full bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <PrinterIcon size={16} className="w-4 h-4" />
                {isPrinting ? 'Sending to Print Queue...' : 'Send to Print Queue'}
              </button>

              <button
                onClick={() => onUpdateStatus('printing')}
                disabled={order.orderStatus === 'printing' || isUpdating}
                className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUpdating ? 'Updating...' : 'Mark as Printing'}
              </button>

              {onMarkAsPrinted && (
                <button
                  onClick={onMarkAsPrinted}
                  disabled={order.orderStatus !== 'printing' || isUpdating}
                  className="w-full bg-teal-600 text-white px-4 py-2.5 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
                >
                  <CheckIcon size={16} className="w-4 h-4" />
                  {isUpdating ? 'Updating...' : '✅ Mark as Printed'}
                </button>
              )}

              <button
                onClick={() => onUpdateStatus('dispatched')}
                disabled={order.orderStatus === 'dispatched' || isUpdating}
                className="w-full bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUpdating ? 'Updating...' : 'Mark as Dispatched'}
              </button>

              <button
                onClick={() => onUpdateStatus('delivered')}
                disabled={order.orderStatus === 'delivered' || isUpdating}
                className="w-full bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUpdating ? 'Updating...' : 'Mark as Delivered'}
              </button>

              <button
                onClick={onDeleteOrder}
                disabled={isUpdating}
                className="w-full bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                {isUpdating ? 'Deleting...' : 'Delete Order'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


