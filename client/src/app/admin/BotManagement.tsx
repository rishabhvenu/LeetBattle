'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'react-toastify';
import { Bot, Settings, Activity, Zap, Plus, Play, Square, Trash2, Edit, User, Users, Trophy, Target } from 'lucide-react';
import { getAvatarUrl } from '@/lib/utils';
import {
  generateBotProfile, 
  getBots, 
  deployBots, 
  updateBot, 
  deleteBot, 
  resetBotData,
  deleteAllBots,
  resetBotStats
} from '@/lib/actions';
import { BotDoc, BotStats } from '@/types/bot';

export default function BotManagement() {
  const [bots, setBots] = useState<BotDoc[]>([]);
  const [stats, setStats] = useState<BotStats>({
    totalBots: 0,
    deployedBots: 0,
    activeBots: 0,
    totalMatches: 0,
    averageRating: 1200
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  
  // Generation dialog state
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [generateCount, setGenerateCount] = useState(5);
  const [generateGender, setGenerateGender] = useState<'male' | 'female' | 'random'>('random');
  const [generateRating, setGenerateRating] = useState(1200);
  
  // Edit dialog state
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingBot, setEditingBot] = useState<BotDoc | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: '',
    username: '',
    rating: 1200
  });

  useEffect(() => {
    fetchBots();
  }, []);

  const fetchBots = async () => {
    try {
      setIsLoading(true);
      const result = await getBots();
      if (result.success) {
        setBots(result.bots);
        calculateStats(result.bots);
      } else {
        toast.error('Failed to fetch bots');
      }
    } catch (error) {
      console.error('Error fetching bots:', error);
      toast.error('Failed to fetch bots');
    } finally {
      setIsLoading(false);
    }
  };

  const calculateStats = (botList: BotDoc[]) => {
    const totalBots = botList.length;
    const deployedBots = botList.filter(bot => bot.deployed).length;
    const totalMatches = botList.reduce((sum, bot) => sum + bot.stats.totalMatches, 0);
    const averageRating = totalBots > 0 
      ? Math.round(botList.reduce((sum, bot) => sum + bot.stats.rating, 0) / totalBots)
      : 1200;

    setStats({
      totalBots,
      deployedBots,
      activeBots: 0, // This would come from Redis in a real implementation
      totalMatches,
      averageRating
    });
  };

  const handleGenerateBots = async () => {
    try {
      setIsGenerating(true);
      const gender = generateGender === 'random' ? 'random' : generateGender;
      const result = await generateBotProfile(generateCount, gender);
      
      if (result.success) {
        toast.success(`Generated ${generateCount} bots successfully!`);
        setShowGenerateDialog(false);
        fetchBots();
      } else {
        toast.error(result.error || 'Failed to generate bots');
      }
    } catch (error) {
      console.error('Error generating bots:', error);
      toast.error('Failed to generate bots');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeployBots = async (botIds: string[], deploy: boolean) => {
    try {
      setIsDeploying(true);
      const result = await deployBots(botIds, deploy);
      
      if (result.success) {
        toast.success(result.message);
        fetchBots();
      } else {
        toast.error(result.error || 'Failed to deploy bots');
      }
    } catch (error) {
      console.error('Error deploying bots:', error);
      toast.error('Failed to deploy bots');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleToggleDeploy = async (bot: BotDoc) => {
    await handleDeployBots([bot._id.toString()], !bot.deployed);
  };

  const handleEditBot = (bot: BotDoc) => {
    setEditingBot(bot);
    setEditForm({
      fullName: bot.fullName,
      username: bot.username,
      rating: bot.stats.rating
    });
    setShowEditDialog(true);
  };

  const handleUpdateBot = async () => {
    if (!editingBot) return;
    
    try {
      const result = await updateBot(editingBot._id.toString(), {
        fullName: editForm.fullName,
        username: editForm.username,
        'stats.rating': editForm.rating
      });
      
      if (result.success) {
        toast.success('Bot updated successfully!');
        setShowEditDialog(false);
        fetchBots();
      } else {
        toast.error(result.error || 'Failed to update bot');
      }
    } catch (error) {
      console.error('Error updating bot:', error);
      toast.error('Failed to update bot');
    }
  };

  const handleDeleteBot = async (bot: BotDoc) => {
    if (!confirm(`Are you sure you want to delete ${bot.fullName}?`)) return;
    
    try {
      const result = await deleteBot(bot._id.toString());
      
      if (result.success) {
        toast.success('Bot deleted successfully!');
        fetchBots();
    } else {
        toast.error(result.error || 'Failed to delete bot');
      }
    } catch (error) {
      console.error('Error deleting bot:', error);
      toast.error('Failed to delete bot');
    }
  };

  const handleResetBotData = async (resetType: 'stats' | 'all') => {
    const message = resetType === 'all' 
      ? 'Are you sure you want to delete ALL bots? This cannot be undone!'
      : 'Are you sure you want to reset all bot stats?';
      
    if (!confirm(message)) return;
    
    try {
      setIsResetting(true);
      const result = resetType === 'all' ? await deleteAllBots() : await resetBotStats();
      
      if (result.success) {
        toast.success(result.message);
        fetchBots();
      } else {
        toast.error(result.error || `Failed to ${resetType === 'all' ? 'delete all bots' : 'reset bot stats'}`);
      }
    } catch (error) {
      console.error(`Error ${resetType === 'all' ? 'deleting all bots' : 'resetting bot stats'}:`, error);
      toast.error(`Failed to ${resetType === 'all' ? 'delete all bots' : 'reset bot stats'}`);
    } finally {
      setIsResetting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-700 rounded w-1/4 mb-6"></div>
          <div className="h-4 bg-gray-700 rounded w-1/2 mb-4"></div>
          <div className="h-4 bg-gray-700 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <Bot className="h-6 w-6" />
          Bot Management
        </h2>
        <p className="text-gray-400">Manage bot opponents and monitor their performance</p>
      </div>

      {/* Bot Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400">Total Bots</p>
                <p className="text-2xl font-bold text-white">{stats.totalBots}</p>
              </div>
              <Users className="h-8 w-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400">Deployed</p>
                <p className="text-2xl font-bold text-white">{stats.deployedBots}</p>
              </div>
              <Activity className="h-8 w-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400">Active Matches</p>
                <p className="text-2xl font-bold text-white">{stats.activeBots}</p>
              </div>
              <Zap className="h-8 w-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400">Total Matches</p>
                <p className="text-2xl font-bold text-white">{stats.totalMatches}</p>
              </div>
              <Trophy className="h-8 w-8 text-purple-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400">Avg Rating</p>
                <p className="text-2xl font-bold text-white">{stats.averageRating}</p>
              </div>
              <Target className="h-8 w-8 text-red-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4 flex-wrap">
        <Dialog open={showGenerateDialog} onOpenChange={setShowGenerateDialog}>
          <DialogTrigger asChild>
            <Button className="bg-green-600 hover:bg-green-700 text-white">
              <Plus className="h-4 w-4 mr-2" />
              Generate Bots
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-800 border-gray-700">
            <DialogHeader>
              <DialogTitle className="text-white">Generate New Bots</DialogTitle>
              <DialogDescription className="text-gray-400">
                Create new bots with AI-generated profiles and avatars
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-white">Number of Bots</Label>
                <Input
                  type="number"
                  value={generateCount}
                  onChange={(e) => setGenerateCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  className="bg-gray-700 border-gray-600 text-white"
                  min="1"
                  max="50"
                />
              </div>
              <div>
                <Label className="text-white">Gender Distribution</Label>
                <Select value={generateGender} onValueChange={(value: any) => setGenerateGender(value)}>
                  <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="random">Random</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-white">Initial Rating</Label>
                <Input
                  type="number"
                  value={generateRating}
                  onChange={(e) => setGenerateRating(parseInt(e.target.value) || 1200)}
                  className="bg-gray-700 border-gray-600 text-white"
                  min="0"
                  max="3000"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={handleGenerateBots}
                disabled={isGenerating}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {isGenerating ? 'Generating...' : 'Generate Bots'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Button
          onClick={() => handleDeployBots(bots.filter(b => !b.deployed).map(b => b._id.toString()), true)}
          disabled={isDeploying || bots.filter(b => !b.deployed).length === 0}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Play className="h-4 w-4 mr-2" />
          Deploy All
        </Button>

        <Button
          onClick={() => handleDeployBots(bots.filter(b => b.deployed).map(b => b._id.toString()), false)}
          disabled={isDeploying || bots.filter(b => b.deployed).length === 0}
          variant="outline"
          className="border-gray-600 text-gray-300 hover:bg-gray-700"
        >
          <Square className="h-4 w-4 mr-2" />
          Stop All
        </Button>

        <Button
          onClick={() => handleResetBotData('stats')}
          disabled={isResetting}
          variant="outline"
          className="border-orange-600 text-orange-300 hover:bg-orange-700"
        >
          <Settings className="h-4 w-4 mr-2" />
          Reset Stats
        </Button>

        <Button
          onClick={() => handleResetBotData('all')}
          disabled={isResetting}
          variant="outline"
          className="border-red-600 text-red-300 hover:bg-red-700"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete All
        </Button>
      </div>

      {/* Bot List */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Bot Roster
          </CardTitle>
          <CardDescription className="text-gray-400">
            Manage individual bot settings and deployment status
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bots.length === 0 ? (
            <div className="text-center py-8">
              <Bot className="h-12 w-12 text-gray-500 mx-auto mb-4" />
              <p className="text-gray-400 mb-4">No bots created yet</p>
              <Button
                onClick={() => setShowGenerateDialog(true)}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <Plus className="h-4 w-4 mr-2" />
                Generate Your First Bots
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {bots.map((bot) => (
                <div key={bot._id.toString()} className="flex items-center justify-between p-4 border border-gray-600 rounded-lg">
                  <div className="flex items-center gap-4">
                    <Avatar className="w-12 h-12">
                      <AvatarImage
                        src={getAvatarUrl(bot.avatar)}
                        alt={`${bot.fullName} avatar`}
                      />
                      <AvatarFallback className="bg-gray-700">
                        <User className="h-6 w-6 text-gray-400" />
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-white font-medium">{bot.fullName}</h3>
                        <Badge variant={bot.deployed ? "default" : "secondary"}>
                          {bot.deployed ? "Deployed" : "Stopped"}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {bot.gender}
                        </Badge>
                      </div>
                      <p className="text-gray-400 text-sm">@{bot.username}</p>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span>Rating: {bot.stats.rating}</span>
                        <span>W: {bot.stats.wins} L: {bot.stats.losses} D: {bot.stats.draws}</span>
                        <span>Matches: {bot.stats.totalMatches}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
            <Switch
                      checked={bot.deployed}
                      onCheckedChange={() => handleToggleDeploy(bot)}
                      disabled={isDeploying}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEditBot(bot)}
                      className="border-gray-600 text-gray-300 hover:bg-gray-700"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeleteBot(bot)}
                      className="border-red-600 text-red-300 hover:bg-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
          </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Bot Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-gray-800 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Bot</DialogTitle>
            <DialogDescription className="text-gray-400">
              Update bot information and stats
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-white">Full Name</Label>
              <Input
                value={editForm.fullName}
                onChange={(e) => setEditForm(prev => ({ ...prev, fullName: e.target.value }))}
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
            <div>
              <Label className="text-white">Username</Label>
              <Input
                value={editForm.username}
                onChange={(e) => setEditForm(prev => ({ ...prev, username: e.target.value }))}
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
          <div>
              <Label className="text-white">Rating</Label>
                        <Input
                          type="number"
                value={editForm.rating}
                onChange={(e) => setEditForm(prev => ({ ...prev, rating: parseInt(e.target.value) || 1200 }))}
                className="bg-gray-700 border-gray-600 text-white"
                min="0"
                max="3000"
                        />
                      </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleUpdateBot}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Update Bot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}