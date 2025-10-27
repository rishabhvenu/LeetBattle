import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Get the full URL for a user's avatar, or return undefined if no avatar exists
 * @param avatar - The avatar path/filename from the database (can be null/undefined)
 * @returns Full URL to avatar or undefined (so Avatar component can handle fallback)
 */
export function getAvatarUrl(avatar: string | null | undefined): string | undefined {
  if (!avatar) {
    return undefined; // Let Avatar component handle the fallback
  }
  
  const bucketUrl = process.env.NEXT_PUBLIC_PFP_BUCKET_URL || "";
  return `${bucketUrl}${avatar}`;
}
