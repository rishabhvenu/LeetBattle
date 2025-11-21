// @ts-nocheck
import axios, { AxiosInstance } from "axios";
import { REST_ENDPOINTS } from "../constants/RestEndpoints";
import { User } from "../types/rest";
import { GlobalStats, RunInfo } from "@/types/match";
import { MatchInfo } from "@/types/match";
import { Settings } from "@/types/settings";

class RestHandler {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_SERVER_URL || '',
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

  async getSession(): Promise<unknown> {
    try {
      return await this.getData<unknown>(REST_ENDPOINTS.AUTH.SESSION);
    } catch {
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
    params?: Record<string, unknown>
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
    body?: Record<string, unknown>
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
    body?: Record<string, unknown>
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
    params?: Record<string, unknown>
  ): Promise<T> {
    const url = urlParams
      ? this.replacePathParams(endpoint, urlParams)
      : endpoint;
    const response = await this.api.delete<T>(url, { params });
    return response.data;
  }
}

export default RestHandler;
