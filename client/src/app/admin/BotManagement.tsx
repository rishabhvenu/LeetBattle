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
  resetBotStats,
  setRotationConfig,
  getRotationStatus,
  initializeRotationSystem
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
  
  // Rotation configuration state
  const [rotationStatus, setRotationStatus] = useState({
    maxDeployed: 5,
    totalBots: 0,
    deployedCount: 0,
    activeCount: 0,
    rotationQueue: [] as string[],
    queueLength: 0
  });
  const [maxDeployedInput, setMaxDeployedInput] = useState(5);
  const [isUpdatingRotation, setIsUpdatingRotation] = useState(false);
  const [isInitializingRotation, setIsInitializingRotation] = useState(false);
  
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
        // Refresh rotation status after fetching bots
        await fetchRotationStatus();
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

  const fetchRotationStatus = async () => {
    try {
      const result = await getRotationStatus();
      if (result.success) {
        setRotationStatus(result.status);
        setMaxDeployedInput(result.status.maxDeployed);
        // Recalculate stats with updated rotation status
        calculateStats(bots);
      } else {
        console.error('Failed to fetch rotation status:', result.error);
        // Set default values if rotation status fails
        setRotationStatus({
          maxDeployed: 5,
          totalBots: bots.length,
          deployedCount: 0, // Default to 0 since we can't read from MongoDB
          activeCount: 0,
          rotationQueue: [],
          queueLength: 0
        });
        setMaxDeployedInput(5);
        // Recalculate stats with default values
        calculateStats(bots);
      }
    } catch (error) {
      console.error('Error fetching rotation status:', error);
      // Set default values if rotation status fails
      setRotationStatus({
        maxDeployed: 5,
        totalBots: bots.length,
        deployedCount: 0, // Default to 0 since we can't read from MongoDB
        activeCount: 0,
        rotationQueue: [],
        queueLength: 0
      });
      setMaxDeployedInput(5);
      // Recalculate stats with default values
      calculateStats(bots);
    }
  };

  const handleUpdateRotationConfig = async () => {
    try {
      setIsUpdatingRotation(true);
      const result = await setRotationConfig(maxDeployedInput);
      
      if (result.success) {
        toast.success('Rotation configuration updated successfully!');
        await fetchRotationStatus();
      } else {
        toast.error(result.error || 'Failed to update rotation configuration');
      }
    } catch (error) {
      console.error('Error updating rotation config:', error);
      toast.error('Failed to update rotation configuration');
    } finally {
      setIsUpdatingRotation(false);
    }
  };

  const handleInitializeRotation = async () => {
    try {
      setIsInitializingRotation(true);
      const result = await initializeRotationSystem();
      
      if (result.success) {
        toast.success('Rotation system initialized successfully!');
        await fetchRotationStatus();
      } else {
        toast.error(result.error || 'Failed to initialize rotation system');
      }
    } catch (error) {
      console.error('Error initializing rotation system:', error);
      toast.error('Failed to initialize rotation system');
    } finally {
      setIsInitializingRotation(false);
    }
  };

  // Helper function to check if a bot is deployed (from Redis data)
  const isBotDeployed = (botId: string) => {
    // Use the actual deployed bot IDs from Redis
    return rotationStatus.deployedBots?.includes(botId) || false;
  };

  const calculateStats = (botList: BotDoc[]) => {
    const totalBots = botList.length;
    // Use Redis data from rotation status instead of MongoDB deployed field
    const deployedBots = rotationStatus.deployedCount || 0;
    const totalMatches = botList.reduce((sum, bot) => sum + bot.stats.totalMatches, 0);
    const averageRating = totalBots > 0 
      ? Math.round(botList.reduce((sum, bot) => sum + bot.stats.rating, 0) / totalBots)
      : 1200;

    setStats({
      totalBots,
      deployedBots,
      activeBots: rotationStatus.activeCount || 0, // From Redis
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
          <div className="h-8 bg-white/60 rounded w-1/4 mb-6"></div>
          <div className="h-4 bg-white/60 rounded w-1/2 mb-4"></div>
          <div className="h-4 bg-white/60 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-black mb-2 flex items-center gap-2">
          <Bot className="h-6 w-6" style={{ color: '#2599D4' }} />
          Bot Management
        </h2>
        <p className="text-black/70">Manage bot opponents and monitor their performance</p>
      </div>

      {/* Bot Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black/70">Total Bots</p>
                <p className="text-2xl font-bold text-black">{stats.totalBots}</p>
              </div>
              <Users className="h-8 w-8" style={{ color: '#2599D4' }} />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black/70">Deployed</p>
                <p className="text-2xl font-bold text-black">{stats.deployedBots}</p>
              </div>
              <Activity className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black/70">Active Matches</p>
                <p className="text-2xl font-bold text-black">{stats.activeBots}</p>
              </div>
              <Zap className="h-8 w-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black/70">Total Matches</p>
                <p className="text-2xl font-bold text-black">{stats.totalMatches}</p>
              </div>
              <Trophy className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black/70">Avg Rating</p>
                <p className="text-2xl font-bold text-black">{stats.averageRating}</p>
              </div>
              <Target className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rotation Configuration */}
      <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
        <CardHeader>
          <CardTitle className="text-black flex items-center gap-2">
            <Settings className="h-5 w-5" style={{ color: '#2599D4' }} />
            Bot Rotation Configuration
          </CardTitle>
          <CardDescription className="text-black/70">
            Configure how many bots should be deployed and manage the rotation queue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Current Status */}
            <div className="space-y-4">
              <h4 className="font-medium text-black">Current Status</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-black/70">Deployed:</span>
                  <span className="font-medium text-black">{rotationStatus.deployedCount}/{rotationStatus.totalBots}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/70">Active Matches:</span>
                  <span className="font-medium text-black">{rotationStatus.activeCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/70">Queued Players:</span>
                  <span className="font-medium text-black">{rotationStatus.queuedPlayersCount || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/70">Target Deployed:</span>
                  <span className="font-medium text-black">{rotationStatus.targetDeployed || rotationStatus.maxDeployed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/70">Min Deployed:</span>
                  <span className="font-medium text-black">{rotationStatus.maxDeployed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/70">In Rotation Queue:</span>
                  <span className="font-medium text-black">{rotationStatus.queueLength}</span>
                </div>
              </div>
            </div>

            {/* Configuration */}
            <div className="space-y-4">
              <h4 className="font-medium text-black">Configuration</h4>
              <div className="space-y-3">
                <div>
                  <Label className="text-black">Minimum Deployed Bots</Label>
                  <Input
                    type="number"
                    value={maxDeployedInput}
                    onChange={(e) => setMaxDeployedInput(Math.max(0, parseInt(e.target.value) || 0))}
                    className="bg-white border-blue-200 text-black"
                    min="0"
                    max={rotationStatus.totalBots}
                  />
                    <p className="text-xs text-black/60 mt-1">
                      Minimum baseline (always maintained) + 1 bot per queued player
                    </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleUpdateRotationConfig}
                    disabled={isUpdatingRotation || maxDeployedInput === rotationStatus.maxDeployed}
                    className="text-white"
                    style={{ backgroundColor: '#2599D4' }}
                  >
                    {isUpdatingRotation ? 'Updating...' : 'Apply Configuration'}
                  </Button>
                  <Button
                    onClick={fetchRotationStatus}
                    variant="outline"
                    className="border-blue-200 text-black hover:bg-blue-50"
                  >
                    Refresh
                  </Button>
                  <Button
                    onClick={handleInitializeRotation}
                    disabled={isInitializingRotation}
                    variant="outline"
                    className="border-green-500 text-green-600 hover:bg-green-50"
                  >
                    {isInitializingRotation ? 'Initializing...' : 'Initialize System'}
                  </Button>
                </div>
              </div>
            </div>

            {/* Rotation Queue Preview */}
            <div className="space-y-4">
              <h4 className="font-medium text-black">Next in Rotation</h4>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {rotationStatus.rotationQueue.slice(0, 5).map((botId, index) => {
                  const bot = bots.find(b => b._id.toString() === botId);
                  return (
                    <div key={botId} className="flex items-center gap-2 p-2 bg-blue-50 rounded text-sm">
                      <span className="text-black/60">#{index + 1}</span>
                      <span className="text-black font-medium">
                        {bot ? bot.fullName : `Bot ${botId.slice(-4)}`}
                      </span>
                    </div>
                  );
                })}
                {rotationStatus.rotationQueue.length === 0 && (
                  <p className="text-black/60 text-sm">No bots in rotation queue</p>
                )}
                {rotationStatus.rotationQueue.length > 5 && (
                  <p className="text-black/60 text-xs">
                    +{rotationStatus.rotationQueue.length - 5} more bots
                  </p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex gap-4 flex-wrap">
        <Dialog open={showGenerateDialog} onOpenChange={setShowGenerateDialog}>
          <DialogTrigger asChild>
            <Button className="bg-green-600 hover:bg-green-700 text-white">
              <Plus className="h-4 w-4 mr-2" />
              Generate Bots
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-white border-blue-200">
            <DialogHeader>
              <DialogTitle className="text-black">Generate New Bots</DialogTitle>
              <DialogDescription className="text-black/70">
                Create new bots with AI-generated profiles and avatars
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-black">Number of Bots</Label>
                <Input
                  type="number"
                  value={generateCount}
                  onChange={(e) => setGenerateCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  className="bg-white border-blue-200 text-black"
                  min="1"
                  max="50"
                />
              </div>
              <div>
                <Label className="text-black">Gender Distribution</Label>
                <Select value={generateGender} onValueChange={(value: any) => setGenerateGender(value)}>
                  <SelectTrigger className="bg-white border-blue-200 text-black">
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
                <Label className="text-black">Initial Rating</Label>
                <Input
                  type="number"
                  value={generateRating}
                  onChange={(e) => setGenerateRating(parseInt(e.target.value) || 1200)}
                  className="bg-white border-blue-200 text-black"
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
          onClick={() => handleDeployBots(bots.filter(b => !isBotDeployed(b._id.toString())).map(b => b._id.toString()), true)}
          disabled={isDeploying || bots.filter(b => !isBotDeployed(b._id.toString())).length === 0}
          className="text-white"
          style={{ backgroundColor: '#2599D4' }}
        >
          <Play className="h-4 w-4 mr-2" />
          Deploy All
        </Button>

        <Button
          onClick={() => handleDeployBots(bots.filter(b => isBotDeployed(b._id.toString())).map(b => b._id.toString()), false)}
          disabled={isDeploying || bots.filter(b => isBotDeployed(b._id.toString())).length === 0}
          variant="outline"
          className="border-blue-200 text-black hover:bg-blue-50"
        >
          <Square className="h-4 w-4 mr-2" />
          Stop All
        </Button>

        <Button
          onClick={() => handleResetBotData('stats')}
          disabled={isResetting}
          variant="outline"
          className="border-orange-500 text-orange-600 hover:bg-orange-50"
        >
          <Settings className="h-4 w-4 mr-2" />
          Reset Stats
        </Button>

        <Button
          onClick={() => handleResetBotData('all')}
          disabled={isResetting}
          variant="outline"
          className="border-red-500 text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete All
        </Button>
      </div>

      {/* Bot List */}
      <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
        <CardHeader>
          <CardTitle className="text-black flex items-center gap-2">
            <Bot className="h-5 w-5" style={{ color: '#2599D4' }} />
            Bot Roster
          </CardTitle>
          <CardDescription className="text-black/70">
            Manage individual bot settings and deployment status
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bots.length === 0 ? (
            <div className="text-center py-8">
              <Bot className="h-12 w-12 mx-auto mb-4" style={{ color: '#2599D4' }} />
              <p className="text-black/70 mb-4">No bots created yet</p>
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
                <div key={bot._id.toString()} className="flex items-center justify-between p-4 border border-blue-200 rounded-lg bg-blue-50">
                  <div className="flex items-center gap-4">
                    <Avatar className="w-12 h-12">
                      <AvatarImage
                        src={getAvatarUrl(bot.avatar)}
                        alt={`${bot.fullName} avatar`}
                      />
                      <AvatarFallback className="bg-gray-600">
                        <User className="h-6 w-6 text-white" />
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-black font-medium">{bot.fullName}</h3>
                        <Badge variant={isBotDeployed(bot._id.toString()) ? "default" : "secondary"}>
                          {isBotDeployed(bot._id.toString()) ? "Deployed" : "Stopped"}
                        </Badge>
                        {!isBotDeployed(bot._id.toString()) && rotationStatus.rotationQueue.includes(bot._id.toString()) && (
                          <Badge variant="outline" className="text-xs bg-blue-100 text-blue-700">
                            Queue #{rotationStatus.rotationQueue.indexOf(bot._id.toString()) + 1}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {bot.gender}
                        </Badge>
                      </div>
                      <p className="text-black/70 text-sm">@{bot.username}</p>
                      <div className="flex items-center gap-4 text-sm text-black/70">
                        <span>Rating: {bot.stats.rating}</span>
                        <span>W: {bot.stats.wins} L: {bot.stats.losses} D: {bot.stats.draws}</span>
                        <span>Matches: {bot.stats.totalMatches}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
            <Switch
                      checked={isBotDeployed(bot._id.toString())}
                      onCheckedChange={() => handleToggleDeploy(bot)}
                      disabled={isDeploying}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEditBot(bot)}
                      className="border-blue-200 text-black hover:bg-blue-50"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeleteBot(bot)}
                      className="border-red-500 text-red-600 hover:bg-red-50"
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
        <DialogContent className="bg-white border-blue-200">
          <DialogHeader>
            <DialogTitle className="text-black">Edit Bot</DialogTitle>
            <DialogDescription className="text-black/70">
              Update bot information and stats
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-black">Full Name</Label>
              <Input
                value={editForm.fullName}
                onChange={(e) => setEditForm(prev => ({ ...prev, fullName: e.target.value }))}
                className="bg-white border-blue-200 text-black"
              />
            </div>
            <div>
              <Label className="text-black">Username</Label>
              <Input
                value={editForm.username}
                onChange={(e) => setEditForm(prev => ({ ...prev, username: e.target.value }))}
                className="bg-white border-blue-200 text-black"
              />
            </div>
          <div>
              <Label className="text-black">Rating</Label>
                        <Input
                          type="number"
                value={editForm.rating}
                onChange={(e) => setEditForm(prev => ({ ...prev, rating: parseInt(e.target.value) || 1200 }))}
                className="bg-white border-blue-200 text-black"
                min="0"
                max="3000"
                        />
                      </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleUpdateBot}
              className="text-white"
              style={{ backgroundColor: '#2599D4' }}
            >
              Update Bot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}