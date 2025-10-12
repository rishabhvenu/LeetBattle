// Placeholder REST service - replace with actual server implementation
export interface PlaceholderUser {
  _id: string;
  name: string;
  email: string;
  username: string;
  profilePicture?: string;
  rating?: number;
  level?: number;
  experience?: number;
}


export interface PlaceholderSession {
  user: PlaceholderUser;
  isAuthenticated: boolean;
  username: string;
  timeCoded: number;
  problemsSolved: number;
  globalRank: number;
  currentStreak: number;
}

class PlaceholderRestService {
  // Mock data
  private mockUser: PlaceholderUser = {
    _id: "mock-user-id",
    name: "Mock User",
    email: "mock@example.com",
    username: "mockuser",
    profilePicture: "/logo.png",
    rating: 1200,
    level: 5,
    experience: 2500
  };

  private mockSession: PlaceholderSession = {
    user: this.mockUser,
    isAuthenticated: true,
    username: "mockuser",
    timeCoded: 150,
    problemsSolved: 42,
    globalRank: 1250,
    currentStreak: 7
  };

  private isLoggedIn: boolean = false;


  // Authentication methods
  async getSession(): Promise<PlaceholderSession | null> {
    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 100));
    return this.isLoggedIn ? this.mockSession : null;
  }

  async login(email: string, password: string): Promise<PlaceholderSession> {
    await new Promise(resolve => setTimeout(resolve, 500));
    this.isLoggedIn = true;
    return this.mockSession;
  }

  async register(userData: any): Promise<PlaceholderSession> {
    await new Promise(resolve => setTimeout(resolve, 500));
    this.isLoggedIn = true;
    return this.mockSession;
  }

  async logout(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 200));
    this.isLoggedIn = false;
  }

  async handshake(): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 100));
    return "mock-cookie-token";
  }


  // Match/Game methods
  async joinMatchQueue(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  async leaveMatchQueue(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  async getMatchInfo(): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 200));
    return null;
  }

  async submitSolution(problemId: string, solution: string, language: string): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { success: true, score: 100 };
  }

  async getProblems(): Promise<any[]> {
    await new Promise(resolve => setTimeout(resolve, 300));
    return [];
  }

  async getLeaderboard(): Promise<PlaceholderUser[]> {
    await new Promise(resolve => setTimeout(resolve, 300));
    return [this.mockUser];
  }

  // Settings methods
  async getSettings(): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 200));
    return {
      theme: "dark",
      language: "javascript",
      notifications: true
    };
  }

  async updateSettings(settings: any): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // Activity methods
  async getActivity(): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 200));
    return {
      "2024-01-15": { count: 3 },
      "2024-01-16": { count: 5 },
      "2024-01-17": { count: 2 },
      "2024-01-18": { count: 7 },
      "2024-01-19": { count: 4 },
      "2024-01-20": { count: 6 },
      "2024-01-21": { count: 3 }
    };
  }

  // General stats for landing page
  async getGeneralStats(): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 200));
    return {
      activePlayers: 1250,
      matchesCompleted: 15600
    };
  }
}

export default PlaceholderRestService;
