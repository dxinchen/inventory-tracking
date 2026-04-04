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

export function getDriveItemUrl(path: string): string {
  if (!driveId) throw new Error('VITE_SHAREPOINT_DRIVE_ID not configured');
  return `https://graph.microsoft.com/v1.0/drives/${driveId}/root:${path}:`;
}

export function getDriveChildrenUrl(): string {
  if (!driveId) throw new Error('VITE_SHAREPOINT_DRIVE_ID not configured');
  return `https://graph.microsoft.com/v1.0/drives/${driveId}/root:${getBasePath()}:/children`;
}
