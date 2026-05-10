const driveId = import.meta.env.VITE_SHAREPOINT_DRIVE_ID;

export function getBasePath(): string {
  return import.meta.env.VITE_SHAREPOINT_FOLDER_PATH || '/InventoryApp';
}

export function getTransactionsPath(): string {
  return `${getBasePath()}/transactions.json`;
}

export function getImagesFolderPath(): string {
  return `${getBasePath()}/images`;
}

export function getImageFilePath(filename: string): string {
  return `${getBasePath()}/images/${filename}`;
}

export function getOrdersFolderPath(): string {
  return `${getBasePath()}/orders`;
}

export function getOrderFolderPath(orderId: string): string {
  return `${getBasePath()}/orders/${orderId}`;
}

export function getOrderFilePath(orderId: string, filename: string): string {
  return `${getBasePath()}/orders/${orderId}/${filename}`;
}

export function getDriveItemUrl(path: string): string {
  if (!driveId) throw new Error('VITE_SHAREPOINT_DRIVE_ID not configured');
  return `https://graph.microsoft.com/v1.0/drives/${driveId}/root:${path}:`;
}

export function getDriveChildrenUrl(folderPath: string = getBasePath()): string {
  if (!driveId) throw new Error('VITE_SHAREPOINT_DRIVE_ID not configured');
  return `https://graph.microsoft.com/v1.0/drives/${driveId}/root:${folderPath}:/children`;
}
