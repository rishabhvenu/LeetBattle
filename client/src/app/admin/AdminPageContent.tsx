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
      <div className="min-h-screen bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-700 rounded w-1/4 mb-6"></div>
            <div className="h-4 bg-gray-700 rounded w-1/2 mb-4"></div>
            <div className="h-4 bg-gray-700 rounded w-3/4"></div>
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
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
            <Settings className="h-8 w-8" />
            Admin Panel
          </h1>
          <p className="text-gray-400">Monitor matches, manage problems, users, and bot opponents</p>
        </div>

        <Tabs defaultValue="matches" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 bg-gray-800 border-gray-700">
            <TabsTrigger value="matches" className="flex items-center gap-2 data-[state=active]:bg-gray-700">
              <Eye className="h-4 w-4" />
              Active Matches
            </TabsTrigger>
            <TabsTrigger value="problems" className="flex items-center gap-2 data-[state=active]:bg-gray-700">
              <FileText className="h-4 w-4" />
              Problems
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2 data-[state=active]:bg-gray-700">
              <Users className="h-4 w-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="bots" className="flex items-center gap-2 data-[state=active]:bg-gray-700">
              <Bot className="h-4 w-4" />
              Bots
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2 data-[state=active]:bg-gray-700">
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
                <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                  <Settings className="h-6 w-6" />
                  System Settings
                </h2>
                <p className="text-gray-400">Manage system-wide settings and dangerous operations</p>
              </div>

          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Trash2 className="h-5 w-5 text-red-400" />
                    Danger Zone
                  </CardTitle>
              <CardDescription className="text-gray-400">
                    Irreversible actions that will permanently delete data
              </CardDescription>
            </CardHeader>
            <CardContent>
                  <div className="flex items-center justify-between p-4 border border-red-600 rounded-lg bg-red-900/10">
                                        <div>
                      <h3 className="text-white font-medium">Reset All Player Data</h3>
                      <p className="text-sm text-gray-400">This will permanently delete all player data including matches, submissions, and statistics.</p>
                    </div>
          <Button
            onClick={() => setResetDialogOpen(true)}
            variant="outline"
            className="border-red-600 text-red-400 hover:bg-red-900/20"
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
          <DialogContent className="bg-gray-800 border-gray-700">
            <DialogHeader>
              <DialogTitle className="text-white">Reset All Player Data</DialogTitle>
              <DialogDescription className="text-gray-400">
                This will permanently delete all player data including matches, submissions, and statistics. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-4">
              <Button
                onClick={() => setResetDialogOpen(false)}
                variant="outline"
                className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
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
