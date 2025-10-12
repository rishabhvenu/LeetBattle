import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Get the full URL for a user's avatar, or return placeholder if no avatar exists
 * @param avatar - The avatar path/filename from the database (can be null/undefined)
 * @returns Full URL to avatar or placeholder image
 */
export function getAvatarUrl(avatar: string | null | undefined): string {
  if (!avatar) {
    return "/placeholder_avatar.png";
  }
  
  const bucketUrl = process.env.NEXT_PUBLIC_PFP_BUCKET_URL || "";
  return `${bucketUrl}${avatar}`;
}
