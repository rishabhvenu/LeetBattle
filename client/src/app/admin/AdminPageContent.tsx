'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'react-toastify';
import { resetAllPlayerData } from '@/lib/actions';
import UserManagement from './UserManagement';
import ProblemManagement from './ProblemManagement';
import BotManagement from './BotManagement';
import ActiveMatches from './ActiveMatches';
import { Settings, Users, FileText, Bot, Trash2, Eye } from 'lucide-react';

export default function AdminPageContent() {
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Handle mounting to prevent hydration issues
  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent hydration issues by not rendering until mounted
  if (!mounted) {
    return (
      <div className="min-h-screen bg-blue-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-white/60 rounded w-1/4 mb-6"></div>
            <div className="h-4 bg-white/60 rounded w-1/2 mb-4"></div>
            <div className="h-4 bg-white/60 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }


  const handleResetAllData = async () => {
    setIsResetting(true);
    try {
      const result = await resetAllPlayerData();
      if (result.success) {
        toast.success('All player data reset successfully!');
      } else {
        toast.error(result.error || 'Failed to reset player data');
      }
    } catch (error) {
      console.error('Error resetting data:', error);
      toast.error('Failed to reset player data');
    } finally {
      setIsResetting(false);
      setResetDialogOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-blue-50 p-6 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-0 top-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
        <div className="absolute right-0 bottom-0 h-[500px] w-[500px] bg-cyan-400/6 rounded-full filter blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] bg-blue-500/6 rounded-full filter blur-3xl"></div>
      </div>
      <div className="max-w-7xl mx-auto relative z-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-black mb-2 flex items-center gap-2">
            <Settings className="h-8 w-8" style={{ color: '#2599D4' }} />
            Admin Panel
          </h1>
          <p className="text-black/70">Monitor matches, manage problems, users, and bot opponents</p>
        </div>

        <Tabs defaultValue="matches" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 h-14 bg-white/50 p-1 rounded-lg border border-blue-200 [&_[data-state=active]]:bg-[#2599D4] [&_[data-state=active]]:text-white">
            <TabsTrigger value="matches" className="flex items-center gap-2 rounded-md h-12 text-lg font-medium transition-colors data-[state=inactive]:text-black/70 data-[state=inactive]:hover:text-black">
              <Eye className="h-4 w-4" />
              Active Matches
            </TabsTrigger>
            <TabsTrigger value="problems" className="flex items-center gap-2 rounded-md h-12 text-lg font-medium transition-colors data-[state=inactive]:text-black/70 data-[state=inactive]:hover:text-black">
              <FileText className="h-4 w-4" />
              Problems
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2 rounded-md h-12 text-lg font-medium transition-colors data-[state=inactive]:text-black/70 data-[state=inactive]:hover:text-black">
              <Users className="h-4 w-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="bots" className="flex items-center gap-2 rounded-md h-12 text-lg font-medium transition-colors data-[state=inactive]:text-black/70 data-[state=inactive]:hover:text-black">
              <Bot className="h-4 w-4" />
              Bots
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2 rounded-md h-12 text-lg font-medium transition-colors data-[state=inactive]:text-black/70 data-[state=inactive]:hover:text-black">
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="matches">
            <ActiveMatches />
          </TabsContent>

          <TabsContent value="problems">
            <ProblemManagement />
          </TabsContent>

          <TabsContent value="users">
            <UserManagement />
          </TabsContent>

          <TabsContent value="bots">
            <BotManagement />
          </TabsContent>

          <TabsContent value="settings">
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-black mb-2 flex items-center gap-2">
                  <Settings className="h-6 w-6" style={{ color: '#2599D4' }} />
                  System Settings
                </h2>
                <p className="text-black/70">Manage system-wide settings and dangerous operations</p>
              </div>

          <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
            <CardHeader>
                  <CardTitle className="text-black flex items-center gap-2">
                    <Trash2 className="h-5 w-5 text-red-500" />
                    Danger Zone
                  </CardTitle>
              <CardDescription className="text-black/70">
                    Irreversible actions that will permanently delete data
              </CardDescription>
            </CardHeader>
            <CardContent>
                  <div className="flex items-center justify-between p-4 border border-red-500 rounded-lg bg-red-50">
                                        <div>
                      <h3 className="text-black font-medium">Reset All Player Data</h3>
                      <p className="text-sm text-black/70">This will permanently delete all player data including matches, submissions, and statistics.</p>
                    </div>
          <Button
            onClick={() => setResetDialogOpen(true)}
            variant="outline"
            className="border-red-500 text-red-600 hover:bg-red-50"
          >
                      Reset All Data
                    </Button>
                  </div>
                </CardContent>
              </Card>
                </div>
          </TabsContent>
        </Tabs>


        {/* Reset Confirmation Dialog */}
        <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
          <DialogContent className="bg-white border-blue-200">
            <DialogHeader>
              <DialogTitle className="text-black">Reset All Player Data</DialogTitle>
              <DialogDescription className="text-black/70">
                This will permanently delete all player data including matches, submissions, and statistics. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-4">
              <Button
                onClick={() => setResetDialogOpen(false)}
                variant="outline"
                className="bg-white border-blue-200 text-black hover:bg-blue-50"
              >
                Cancel
              </Button>
              <Button
                onClick={handleResetAllData}
                disabled={isResetting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isResetting ? 'Resetting...' : 'Reset All Data'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
