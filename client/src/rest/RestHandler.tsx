import axios, { AxiosInstance } from "axios";
import { REST_ENDPOINTS } from "../constants/RestEndpoints";
import { Message, Post, User } from "../types/rest";
import { Activity, GlobalStats, RunInfo } from "@/types/match";
import { MatchInfo } from "@/types/match";
import { Settings } from "@/types/settings";

class RestHandler {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_SERVER_URL,
      withCredentials: true,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  }

  private replacePathParams(
    path: string,
    params: Record<string, string>
  ): string {
    let url = path;
    for (const [key, value] of Object.entries(params)) {
      url = url.replace(`:${key}`, value);
    }
    return url;
  }

  async isUsernameValid(username: string): Promise<boolean> {
    const response = await this.getData<{ isAvailable: boolean }>(
      REST_ENDPOINTS.AUTH.USERNAME_VALIDATE,
      null,
      { username }
    );
    return response.isAvailable;
  }

  async isEmailValid(email: string): Promise<boolean> {
    const response = await this.getData<{ isAvailable: boolean }>(
      REST_ENDPOINTS.AUTH.EMAIL_VALIDATE,
      null,
      { email }
    );
    return response.isAvailable;
  }

  async isPasswordValid(password: string): Promise<boolean> {
    const response = await this.getData<{ isAvailable: boolean }>(
      REST_ENDPOINTS.AUTH.PASSWORD_VALIDATE,
      null,
      { password }
    );
    return response.isAvailable;
  }

  async register(
    username: string,
    email: string,
    password: string,
    name: string
  ): Promise<{
    message: string;
    userId: string;
    username: string;
    name: string;
  }> {
    return await this.postData<{
      message: string;
      userId: string;
      username: string;
      name: string;
    }>(REST_ENDPOINTS.AUTH.REGISTER, null, { username, email, password, name });
  }

  async login(
    email: string,
    password: string
  ): Promise<{ message: string; user: { id: string; username: string } }> {
    return await this.postData<{
      message: string;
      user: { id: string; username: string };
    }>(REST_ENDPOINTS.AUTH.LOGIN, null, { email, password });
  }

  async logout(): Promise<{ message: string }> {
    return await this.postData<{ message: string }>(REST_ENDPOINTS.AUTH.LOGOUT);
  }

  async getSession(): Promise<any> {
    try {
      return await this.getData<any>(REST_ENDPOINTS.AUTH.SESSION);
    } catch (e) {
      return null;
    }
  }

  async handshake(): Promise<string> {
    const response = await this.getData<{ cookie: string }>(
      REST_ENDPOINTS.AUTH.HANDSHAKE
    );
    return response.cookie;
  }

  async cancelQueue(): Promise<{ message: string }> {
    return await this.postData<{ message: string }>(
      REST_ENDPOINTS.MATCH.CANCEL
    );
  }

  async createPost(
    content: string,
    tags: string[] = [],
    visibility: "public" | "friends" | "private" = "friends"
  ): Promise<Post> {
    return await this.postData<Post>(REST_ENDPOINTS.POSTS.BASE, null, {
      content,
      tags,
      visibility,
    });
  }

  async getPosts(limit: number = 10, page = 1): Promise<Post[]> {
    return await this.getData<Post[]>(REST_ENDPOINTS.POSTS.BASE, null, {
      limit,
      page,
    });
  }

  async getPopularPosts(limit: number = 10): Promise<Post[]> {
    return await this.getData<Post[]>(REST_ENDPOINTS.POSTS.POPULAR, null, {
      limit,
    });
  }

  async getPost(postId: string): Promise<Post> {
    return await this.getData<Post>(REST_ENDPOINTS.POSTS.BY_ID, { id: postId });
  }

  async updatePost(
    postId: string,
    content: string,
    tags: string[] = [],
    visibility: "public" | "friends" | "private" = "friends"
  ): Promise<Post> {
    return await this.putData<Post>(
      REST_ENDPOINTS.POSTS.BY_ID,
      { id: postId },
      { content, tags, visibility }
    );
  }

  async getUserPosts(limit: number = 10, skip: number = 0): Promise<Post[]> {
    return await this.getData<Post[]>(REST_ENDPOINTS.POSTS.USER, null, {
      limit,
      skip,
    });
  }

  async getPopularUserPosts(
    limit: number = 10,
    skip: number = 0
  ): Promise<Post[]> {
    return await this.getData<Post[]>(REST_ENDPOINTS.POSTS.USER_POPULAR, null, {
      limit,
      skip,
    });
  }

  async deletePost(postId: string): Promise<{ message: string }> {
    return await this.deleteData<{ message: string }>(
      REST_ENDPOINTS.POSTS.BY_ID,
      { id: postId }
    );
  }

  async likePost(postId: string): Promise<Post> {
    return await this.postData<Post>(REST_ENDPOINTS.POSTS.LIKE, { id: postId });
  }

  async unlikePost(postId: string): Promise<Post> {
    return await this.postData<Post>(REST_ENDPOINTS.POSTS.UNLIKE, {
      id: postId,
    });
  }

  async addComment(postId: string, content: string): Promise<Post> {
    return await this.postData<Post>(
      REST_ENDPOINTS.POSTS.COMMENT,
      { id: postId },
      { content }
    );
  }

  async searchUsers(search: string, limit: number = 5): Promise<User[]> {
    if (!search) search = "";
    return (
      await this.getData<{ users: User[] }>(REST_ENDPOINTS.USERS.SEARCH, null, {
        search,
        limit,
      })
    ).users;
  }

  async searchFriends(query: string, limit: number = 5): Promise<User[]> {
    return (
      await this.getData<{ friends: User[] }>(
        REST_ENDPOINTS.USERS.SEARCH_FRIENDS,
        null,
        {
          q: query,
          limit,
        }
      )
    ).friends;
  }

  async sendFriendRequest(id: string): Promise<{ message: string }> {
    return await this.postData<{ message: string }>(
      REST_ENDPOINTS.USERS.FRIEND_REQUEST,
      { id }
    );
  }

  async areFriends(id: string): Promise<boolean> {
    const response = await this.getData<{ areFriends: boolean }>(
      REST_ENDPOINTS.USERS.ARE_FRIENDS,
      { id }
    );
    return response.areFriends;
  }

  async getDetailedUserInfo(id: string): Promise<User> {
    return (
      await this.getData<{ userInfo: User }>(
        REST_ENDPOINTS.USERS.DETAILED_INFO,
        {
          id,
        }
      )
    ).userInfo;
  }

  async getFriends(limit: number = 10, skip: number = 0): Promise<User[]> {
    return (
      await this.getData<{ friends: User[] }>(
        REST_ENDPOINTS.USERS.FRIENDS,
        null,
        {
          limit,
          skip,
        }
      )
    ).friends;
  }

  async getFriendRequests(
    limit: number = 10,
    skip: number = 0
  ): Promise<User[]> {
    return (
      await this.getData<{ friendRequests: User[] }>(
        REST_ENDPOINTS.USERS.FRIEND_REQUESTS,
        null,
        {
          limit,
          skip,
        }
      )
    ).friendRequests;
  }
  async acceptFriendRequest(id: string): Promise<{ message: string }> {
    return await this.postData<{ message: string }>(
      REST_ENDPOINTS.USERS.ACCEPT_FRIEND_REQUEST,
      { id }
    );
  }

  async denyFriendRequest(id: string): Promise<{ message: string }> {
    return await this.postData<{ message: string }>(
      REST_ENDPOINTS.USERS.DENY_FRIEND_REQUEST,
      { id }
    );
  }

  async hasSentFriendRequest(id: string): Promise<boolean> {
    const response = await this.getData<{ hasSentFriendRequest: boolean }>(
      REST_ENDPOINTS.USERS.HAS_SENT_FRIEND_REQUEST,
      { id }
    );
    return response.hasSentFriendRequest;
  }

  async hasReceivedFriendRequest(id: string): Promise<boolean> {
    const response = await this.getData<{ hasReceivedFriendRequest: boolean }>(
      REST_ENDPOINTS.USERS.HAS_RECEIVED_FRIEND_REQUEST,
      { id }
    );
    return response.hasReceivedFriendRequest;
  }

  async removeFriend(id: string): Promise<{ message: string }> {
    return await this.postData<{ message: string }>(
      REST_ENDPOINTS.USERS.REMOVE_FRIEND,
      { id }
    );
  }

  async createMessage(id: string, content: string): Promise<Message> {
    return (
      await this.postData<{ message: Message }>(
        REST_ENDPOINTS.MESSAGES.CREATE,
        { id },
        {
          content,
        }
      )
    ).message;
  }

  async getConversation(
    id: string,
    limit: number = 20,
    skip: number = 0
  ): Promise<{ messages: Message[]; user: User }> {
    return await this.getData<{ messages: Message[]; user: User }>(
      REST_ENDPOINTS.MESSAGES.CONVERSATION,
      { id },
      { limit, skip }
    );
  }

  async getConversationIdByFriend(id: string): Promise<string | null> {
    return (
      await this.getData<{ conversationId: string }>(
        REST_ENDPOINTS.MESSAGES.CONVERSATION_ID_BY_FRIEND,
        { id }
      )
    ).conversationId;
  }

  async updateMessage(id: string, content: string): Promise<Message> {
    return (
      await this.putData<{ message: Message }>(
        REST_ENDPOINTS.MESSAGES.BY_ID,
        { id },
        { content }
      )
    ).message;
  }

  async deleteMessage(id: string): Promise<Message> {
    return (
      await this.deleteData<{ message: Message }>(
        REST_ENDPOINTS.MESSAGES.BY_ID,
        { id }
      )
    ).message;
  }

  async markMessagesAsRead(id: string): Promise<{ message: string }> {
    return await this.postData<{ message: string }>(
      REST_ENDPOINTS.MESSAGES.MARK_AS_READ,
      { id }
    );
  }

  async getUnreadMessageCount(): Promise<number> {
    return (
      await this.getData<{ count: number }>(
        REST_ENDPOINTS.MESSAGES.UNREAD_COUNT
      )
    ).count;
  }

  async getUserConversations(): Promise<any[]> {
    return (
      await this.getData<{ conversations: any[] }>(
        REST_ENDPOINTS.MESSAGES.CONVERSATIONS
      )
    ).conversations;
  }

  async hasLikedPost(postId: string): Promise<boolean> {
    const response = await this.getData<{ hasLiked: boolean }>(
      REST_ENDPOINTS.POSTS.HAS_LIKED,
      { id: postId }
    );
    return response.hasLiked;
  }

  async hasLikedComment(postId: string, commentId: string): Promise<boolean> {
    const response = await this.getData<{ hasLiked: boolean }>(
      REST_ENDPOINTS.POSTS.COMMENT_HAS_LIKED,
      { postId, commentId }
    );
    return response.hasLiked;
  }

  async editComment(
    postId: string,
    commentId: string,
    content: string
  ): Promise<Post> {
    return await this.putData<Post>(
      REST_ENDPOINTS.POSTS.EDIT_COMMENT,
      { postId, commentId },
      { content }
    );
  }

  async deleteComment(
    postId: string,
    commentId: string
  ): Promise<{ message: string }> {
    return await this.deleteData<{ message: string }>(
      REST_ENDPOINTS.POSTS.DELETE_COMMENT,
      { postId, commentId }
    );
  }

  async getCommentLikeCount(
    postId: string,
    commentId: string
  ): Promise<number> {
    const response = await this.getData<{ likeCount: number }>(
      REST_ENDPOINTS.POSTS.COMMENT_LIKE_COUNT,
      { postId, commentId }
    );
    return response.likeCount;
  }

  async likeComment(postId: string, commentId: string): Promise<Post> {
    return await this.postData<Post>(REST_ENDPOINTS.POSTS.COMMENT_LIKE, {
      postId,
      commentId,
    });
  }

  async unlikeComment(postId: string, commentId: string): Promise<Post> {
    return await this.postData<Post>(REST_ENDPOINTS.POSTS.COMMENT_UNLIKE, {
      postId,
      commentId,
    });
  }

  async getCommentCount(postId: string): Promise<number> {
    const response = await this.getData<{ commentCount: number }>(
      REST_ENDPOINTS.POSTS.COMMENT_COUNT,
      { id: postId }
    );
    return response.commentCount;
  }

  async getLikeCount(postId: string): Promise<number> {
    const response = await this.getData<{ likeCount: number }>(
      REST_ENDPOINTS.POSTS.LIKE_COUNT,
      { id: postId }
    );
    return response.likeCount;
  }

  async getComments(
    postId: string,
    skip: number = 0,
    limit: number = 10
  ): Promise<{ comments: Comment[]; hasMore: boolean }> {
    return await this.getData<{ comments: Comment[]; hasMore: boolean }>(
      REST_ENDPOINTS.POSTS.COMMENTS,
      { id: postId },
      { skip, limit }
    );
  }

  async getPopularComments(
    postId: string,
    skip: number = 0,
    limit: number = 10
  ): Promise<{ comments: Comment[]; hasMore: boolean }> {
    return await this.getData<{ comments: Comment[]; hasMore: boolean }>(
      REST_ENDPOINTS.POSTS.POPULAR_COMMENTS,
      { id: postId },
      { skip, limit }
    );
  }

  async getActivity(): Promise<Activity> {
    return (
      await this.getData<{ activity: Activity }>(REST_ENDPOINTS.USERS.ACTIVITY)
    ).activity;
  }
  async queueMatch(): Promise<{ message: string; token: string }> {
    return await this.postData<{ message: string; token: string }>(
      REST_ENDPOINTS.MATCH.QUEUE
    );
  }

  async getMatchInfo(): Promise<MatchInfo> {
    return (
      await this.getData<{ info: MatchInfo }>(REST_ENDPOINTS.MATCH.GET_INFO)
    ).info;
  }

  async runCode(runOption): Promise<RunInfo> {
    return (
      await this.postData<{ runData: RunInfo }>(
        REST_ENDPOINTS.MATCH.RUN,
        null,
        { runOption }
      )
    ).runData;
  }

  async getSettings(): Promise<Settings> {
    return await this.getData<Settings>(REST_ENDPOINTS.SETTINGS.GET_SETTINGS);
  }

  async updateSettings(settings: Settings): Promise<Settings> {
    return await this.putData<Settings>(
      REST_ENDPOINTS.SETTINGS.UPDATE_SETTINGS,
      null,
      { settings }
    );
  }

  async updateProfilePicture(
    fileType: string,
    fileExtension: string
  ): Promise<string> {
    return (
      await this.getData<{ url: string }>(
        REST_ENDPOINTS.SETTINGS.UPDATE_PROFILE_PICTURE,
        null,
        { fileType, fileExtension }
      )
    ).url;
  }

  async getGlobalStats(): Promise<GlobalStats> {
    return await this.getData<GlobalStats>(REST_ENDPOINTS.GLOBAL.GET_STATS);
  }

  async getGeneralStats(): Promise<GlobalStats> {
    return await this.getData<GlobalStats>(
      REST_ENDPOINTS.GLOBAL.GET_GENERAL_STATS
    );
  }

  async createApplication(data): Promise<void> {
    await this.postData<{ message: string }>(
      REST_ENDPOINTS.APPLICATION.BASE,
      null,
      data
    );
  }

  async getTopRankedUsers(
    page: number = 1,
    limit: number = 10
  ): Promise<Partial<User>[]> {
    return (
      await this.getData<{ users: Partial<User>[] }>(
        REST_ENDPOINTS.GLOBAL.GET_TOP_RANKED_USERS,
        null,
        { page, limit }
      )
    ).users;
  }

  private async getData<T>(
    endpoint: string,
    urlParams: Record<string, string> | null = null,
    params?: Record<string, any>
  ): Promise<T> {
    const url = urlParams
      ? this.replacePathParams(endpoint, urlParams)
      : endpoint;
    const response = await this.api.get<T>(url, { params });
    return response.data;
  }

  private async postData<T>(
    endpoint: string,
    urlParams: Record<string, string> | null = null,
    body?: Record<string, any>
  ): Promise<T> {
    const url = urlParams
      ? this.replacePathParams(endpoint, urlParams)
      : endpoint;
    const response = await this.api.post<T>(url, body);
    return response.data;
  }

  private async putData<T>(
    endpoint: string,
    urlParams: Record<string, string> | null = null,
    body?: Record<string, any>
  ): Promise<T> {
    const url = urlParams
      ? this.replacePathParams(endpoint, urlParams)
      : endpoint;
    const response = await this.api.put<T>(url, body);
    return response.data;
  }

  private async deleteData<T>(
    endpoint: string,
    urlParams: Record<string, string> | null = null,
    params?: Record<string, any>
  ): Promise<T> {
    const url = urlParams
      ? this.replacePathParams(endpoint, urlParams)
      : endpoint;
    const response = await this.api.delete<T>(url, { params });
    return response.data;
  }
}

export default RestHandler;
