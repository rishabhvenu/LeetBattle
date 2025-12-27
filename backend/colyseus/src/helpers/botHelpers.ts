/**
 * Bot Helper Functions
 * Extracted from index.ts to improve modularity
 */

import { getRedis, RedisKeys } from '../lib/redis';
import OpenAI from 'openai';
import AWS from 'aws-sdk';

/**
 * Get list of bot user IDs that are currently in active matches
 */
export async function getBotsInActiveMatches(redis: ReturnType<typeof getRedis>): Promise<string[]> {
  try {
    const activeMatchIds = await redis.smembers(RedisKeys.activeMatchesSet);
    if (!activeMatchIds || activeMatchIds.length === 0) {
      return [];
    }

    const matchKeys = activeMatchIds.map((id) => RedisKeys.matchKey(id));
    const matches = await redis.mget(matchKeys);
    const botIds = new Set<string>();

    matches.forEach((data, idx) => {
      if (!data) {
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (parsed?.players) {
          Object.keys(parsed.players).forEach((playerId) => {
            botIds.add(playerId);
          });
        }
      } catch (err) {
        console.error(`Failed to parse match data for ${activeMatchIds[idx]}:`, err);
      }
    });

    return Array.from(botIds);
  } catch (error) {
    console.error('Failed to enumerate bots in active matches:', error);
    return [];
  }
}

export interface BotProfile {
  fullName: string;
  bio: string;
  programmingStyle: string;
  favoriteLanguages: string[];
}

/**
 * Generate a bot profile using GPT-4
 */
export async function generateBotProfile(username: string): Promise<BotProfile> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  const openai = new OpenAI({ apiKey: openaiApiKey });

  const prompt = `Generate a realistic competitive programmer profile for a bot named "${username}". 
Include:
- Full name (realistic, diverse backgrounds)
- Short bio (2-3 sentences about their programming journey)
- Programming style (e.g., "analytical", "creative", "methodical")
- Favorite languages (array of 2-3 programming languages)

Return as JSON with keys: fullName, bio, programmingStyle, favoriteLanguages`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 300,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in GPT-4 response');
    }

    const profile = JSON.parse(content);
    return {
      fullName: profile.fullName || `Bot ${username}`,
      bio: profile.bio || 'A competitive programmer who loves solving challenges.',
      programmingStyle: profile.programmingStyle || 'analytical',
      favoriteLanguages: profile.favoriteLanguages || ['Python', 'JavaScript'],
    };
  } catch (error) {
    console.error('Failed to generate bot profile:', error);
    // Return default profile on error
    return {
      fullName: `Bot ${username}`,
      bio: 'A competitive programmer who loves solving challenges.',
      programmingStyle: 'analytical',
      favoriteLanguages: ['Python', 'JavaScript'],
    };
  }
}

/**
 * Generate a bot avatar using DALL-E 3
 */
export async function generateBotAvatar(
  username: string,
  programmingStyle: string
): Promise<string> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  const openai = new OpenAI({ apiKey: openaiApiKey });

  const prompt = `A professional avatar for a ${programmingStyle} competitive programmer named ${username}. 
Modern, clean, tech-focused. Should look like a realistic profile picture for a coding platform.`;

  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) {
      throw new Error('No image URL in DALL-E response');
    }

    // Download image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.statusText}`);
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    // Upload to S3/MinIO
    const avatarUrl = await uploadBotAvatarToS3(username, imageBuffer);
    return avatarUrl;
  } catch (error) {
    console.error('Failed to generate bot avatar:', error);
    throw error;
  }
}

/**
 * Upload bot avatar to S3/MinIO
 */
async function uploadBotAvatarToS3(username: string, imageBuffer: Buffer): Promise<string> {
  const s3 = new AWS.S3({
    endpoint: process.env.S3_ENDPOINT,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });

  const bucketName = process.env.S3_BUCKET_NAME || 'leetbattle-avatars';
  const key = `bots/${username}-${Date.now()}.png`;

  await s3
    .putObject({
      Bucket: bucketName,
      Key: key,
      Body: imageBuffer,
      ContentType: 'image/png',
      ACL: 'public-read',
    })
    .promise();

  const avatarUrl = `${process.env.S3_PUBLIC_URL || process.env.S3_ENDPOINT}/${bucketName}/${key}`;
  return avatarUrl;
}

/**
 * Delete bot avatar from S3/MinIO
 */
export async function deleteBotAvatar(avatarUrl: string): Promise<void> {
  try {
    const s3 = new AWS.S3({
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      s3ForcePathStyle: true,
      signatureVersion: 'v4',
    });

    const bucketName = process.env.S3_BUCKET_NAME || 'leetbattle-avatars';
    
    // Extract key from URL
    const urlParts = avatarUrl.split('/');
    const key = urlParts.slice(urlParts.indexOf(bucketName) + 1).join('/');

    await s3
      .deleteObject({
        Bucket: bucketName,
        Key: key,
      })
      .promise();

    console.log(`Deleted bot avatar: ${key}`);
  } catch (error) {
    console.error('Failed to delete bot avatar:', error);
    // Don't throw - avatar deletion is not critical
  }
}

