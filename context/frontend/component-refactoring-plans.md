# Frontend Component Refactoring Plans

## BotManagement.tsx Refactoring

### Current State

**File**: `client/src/app/admin/BotManagement.tsx`  
**Size**: 891 lines  
**Problem**: Single component handles bot list, forms, deployment, rotation config

### Proposed Structure

```
client/src/app/admin/bot-management/
├── BotManagement.tsx           # ~150 lines (container)
├── BotList.tsx                 # ~250 lines (bot table)
├── BotForm.tsx                 # ~200 lines (edit form)
├── BotDeployment.tsx           # ~150 lines (deployment controls)
├── RotationConfig.tsx          # ~150 lines (rotation settings)
└── types.ts                    # Shared types
```

### Component Breakdown

#### BotManagement.tsx (~150 lines)

Main container component:

```typescript
export default function BotManagement() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBot, setSelectedBot] = useState<Bot | null>(null);
  
  useEffect(() => {
    loadBots();
  }, []);
  
  return (
    <div className="space-y-6">
      <RotationConfig />
      <BotDeployment bots={bots} onUpdate={loadBots} />
      <BotList 
        bots={bots}
        loading={loading}
        onEdit={setSelectedBot}
        onDelete={handleDelete}
      />
      {selectedBot && (
        <BotForm 
          bot={selectedBot}
          onSave={handleSave}
          onCancel={() => setSelectedBot(null)}
        />
      )}
    </div>
  );
}
```

#### BotList.tsx (~250 lines)

Bot table with sorting and filtering:

```typescript
interface BotListProps {
  bots: Bot[];
  loading: boolean;
  onEdit: (bot: Bot) => void;
  onDelete: (botId: string) => void;
}

export function BotList({ bots, loading, onEdit, onDelete }: BotListProps) {
  const [sortBy, setSortBy] = useState<'rating' | 'name' | 'status'>('rating');
  const [filterStatus, setFilterStatus] = useState<'all' | 'deployed' | 'idle'>('all');
  
  const filteredBots = useMemo(() => {
    return bots
      .filter(bot => filterStatus === 'all' || bot.status === filterStatus)
      .sort((a, b) => sortBots(a, b, sortBy));
  }, [bots, filterStatus, sortBy]);
  
  if (loading) return <Skeleton />;
  
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between">
          <CardTitle>Bots ({bots.length})</CardTitle>
          <BotListFilters 
            sortBy={sortBy}
            filterStatus={filterStatus}
            onSortChange={setSortBy}
            onFilterChange={setFilterStatus}
          />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <BotTableHeader sortBy={sortBy} onSort={setSortBy} />
          <TableBody>
            {filteredBots.map(bot => (
              <BotTableRow 
                key={bot.id}
                bot={bot}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

#### BotForm.tsx (~200 lines)

Bot creation/editing form:

```typescript
interface BotFormProps {
  bot: Bot | null;
  onSave: (bot: Bot) => Promise<void>;
  onCancel: () => void;
}

export function BotForm({ bot, onSave, onCancel }: BotFormProps) {
  const [formData, setFormData] = useState<BotFormData>(
    bot || getDefaultFormData()
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  
  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.username) newErrors.username = 'Username required';
    if (!formData.fullName) newErrors.fullName = 'Full name required';
    if (formData.rating < 800 || formData.rating > 2400) {
      newErrors.rating = 'Rating must be between 800 and 2400';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    
    setSaving(true);
    try {
      await onSave(formData);
      onCancel();
    } catch (error) {
      toast.error('Failed to save bot');
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <Dialog open={!!bot} onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{bot ? 'Edit Bot' : 'Create Bot'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <BotFormFields 
            data={formData}
            errors={errors}
            onChange={setFormData}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

#### BotDeployment.tsx (~150 lines)

Deployment controls:

```typescript
interface BotDeploymentProps {
  bots: Bot[];
  onUpdate: () => void;
}

export function BotDeployment({ bots, onUpdate }: BotDeploymentProps) {
  const [deploying, setDeploying] = useState(false);
  const [selectedBots, setSelectedBots] = useState<string[]>([]);
  
  const deployedBots = bots.filter(b => b.isDeployed);
  const availableBots = bots.filter(b => !b.isDeployed);
  
  const handleDeploy = async (botIds: string[]) => {
    setDeploying(true);
    try {
      await deployBots(botIds, true);
      toast.success(`Deployed ${botIds.length} bots`);
      onUpdate();
    } catch (error) {
      toast.error('Deployment failed');
    } finally {
      setDeploying(false);
    }
  };
  
  const handleUndeploy = async (botIds: string[]) => {
    setDeploying(true);
    try {
      await deployBots(botIds, false);
      toast.success(`Undeployed ${botIds.length} bots`);
      onUpdate();
    } catch (error) {
      toast.error('Undeployment failed');
    } finally {
      setDeploying(false);
    }
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bot Deployment</CardTitle>
        <CardDescription>
          {deployedBots.length} deployed, {availableBots.length} available
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DeploymentControls 
          deployedBots={deployedBots}
          availableBots={availableBots}
          selectedBots={selectedBots}
          deploying={deploying}
          onDeploy={handleDeploy}
          onUndeploy={handleUndeploy}
          onSelect={setSelectedBots}
        />
      </CardContent>
    </Card>
  );
}
```

#### RotationConfig.tsx (~150 lines)

Rotation settings:

```typescript
export function RotationConfig() {
  const [config, setConfig] = useState<RotationConfig | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  
  useEffect(() => {
    loadConfig();
  }, []);
  
  const handleSave = async (newConfig: RotationConfig) => {
    setSaving(true);
    try {
      await setRotationConfig(newConfig.maxDeployed);
      await initializeRotationSystem();
      setConfig(newConfig);
      setEditing(false);
      toast.success('Rotation config updated');
    } catch (error) {
      toast.error('Failed to update config');
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rotation Configuration</CardTitle>
        <CardDescription>Configure bot rotation system</CardDescription>
      </CardHeader>
      <CardContent>
        {editing ? (
          <RotationConfigForm 
            config={config}
            onSave={handleSave}
            onCancel={() => setEditing(false)}
            saving={saving}
          />
        ) : (
          <RotationConfigDisplay 
            config={config}
            onEdit={() => setEditing(true)}
          />
        )}
      </CardContent>
    </Card>
  );
}
```

---

## MatchQueue.tsx Refactoring

### Current State

**File**: `client/src/components/pages/match/MatchQueue.tsx`  
**Size**: 830 lines  
**Problem**: Single component handles queue state, opponent info, lobby

### Proposed Structure

```
client/src/components/pages/match/queue/
├── MatchQueue.tsx              # ~150 lines (container)
├── QueueStatus.tsx             # ~200 lines (queue state display)
├── OpponentCard.tsx            # ~200 lines (opponent information)
├── MatchLobby.tsx              # ~200 lines (pre-match lobby)
└── hooks/
    ├── useQueueConnection.ts   # ~100 lines (queue room connection)
    └── useMatchTransition.ts   # ~100 lines (match navigation)
```

### Component Breakdown

#### MatchQueue.tsx (~150 lines)

Main container:

```typescript
export default function MatchQueue({ userId, username, userAvatar }: MatchQueueProps) {
  const { queueState, connect, disconnect } = useQueueConnection(userId);
  const { navigateToMatch } = useMatchTransition();
  
  useEffect(() => {
    connect();
    return () => disconnect();
  }, []);
  
  useEffect(() => {
    if (queueState.matchFound) {
      navigateToMatch(queueState.matchId!);
    }
  }, [queueState.matchFound]);
  
  if (!queueState.connected) {
    return <QueueConnecting />;
  }
  
  if (queueState.matchFound) {
    return (
      <MatchLobby 
        matchId={queueState.matchId!}
        opponent={queueState.opponent!}
        problem={queueState.problem!}
      />
    );
  }
  
  return (
    <div className="max-w-2xl mx-auto p-6">
      <QueueStatus 
        position={queueState.position}
        waitTime={queueState.waitTime}
        onCancel={disconnect}
      />
      {queueState.opponent && (
        <OpponentCard opponent={queueState.opponent} />
      )}
    </div>
  );
}
```

#### QueueStatus.tsx (~200 lines)

Queue state display:

```typescript
interface QueueStatusProps {
  position: number;
  waitTime: number;
  onCancel: () => void;
}

export function QueueStatus({ position, waitTime, onCancel }: QueueStatusProps) {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  
  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <div className="text-center space-y-4">
          <QueueAnimation />
          <div>
            <h2 className="text-2xl font-bold">Finding Opponent...</h2>
            <p className="text-muted-foreground">
              Position in queue: {position}
            </p>
          </div>
          <WaitTimeDisplay waitTime={waitTime} />
          <Button 
            variant="outline" 
            onClick={() => setCancelDialogOpen(true)}
          >
            Cancel Queue
          </Button>
        </div>
      </CardContent>
      <CancelQueueDialog 
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        onConfirm={onCancel}
      />
    </Card>
  );
}
```

#### OpponentCard.tsx (~200 lines)

Opponent information display:

```typescript
interface OpponentCardProps {
  opponent: OpponentStats;
}

export function OpponentCard({ opponent }: OpponentCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Opponent</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <OpponentAvatar 
            src={opponent.avatar}
            alt={opponent.name}
          />
          <div className="flex-1">
            <OpponentName name={opponent.name} />
            <OpponentStats 
              rating={opponent.rating}
              wins={opponent.gamesWon}
              winRate={opponent.winRate}
              rank={opponent.globalRank}
            />
          </div>
        </div>
        <OpponentBadges opponent={opponent} />
      </CardContent>
    </Card>
  );
}
```

#### MatchLobby.tsx (~200 lines)

Pre-match lobby:

```typescript
interface MatchLobbyProps {
  matchId: string;
  opponent: OpponentStats;
  problem: Problem;
}

export function MatchLobby({ matchId, opponent, problem }: MatchLobbyProps) {
  const [countdown, setCountdown] = useState(5);
  
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => prev - 1);
    }, 1000);
    
    return () => clearInterval(timer);
  }, []);
  
  useEffect(() => {
    if (countdown === 0) {
      // Navigate to match handled by parent
    }
  }, [countdown]);
  
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center space-y-6">
          <MatchupAnimation />
          <div>
            <h2 className="text-3xl font-bold mb-2">Match Found!</h2>
            <p className="text-muted-foreground">
              Starting in {countdown} seconds...
            </p>
          </div>
          <MatchupPreview 
            opponent={opponent}
            problem={problem}
          />
        </div>
      </CardContent>
    </Card>
  );
}
```

#### useQueueConnection.ts (~100 lines)

Custom hook for queue connection:

```typescript
export function useQueueConnection(userId: string) {
  const [queueState, setQueueState] = useState<QueueState>({
    connected: false,
    position: 0,
    waitTime: 0,
    matchFound: false,
    matchId: null,
    opponent: null,
    problem: null,
  });
  
  const roomRef = useRef<Room | null>(null);
  
  const connect = async () => {
    try {
      const room = await connectToQueueRoom(userId);
      roomRef.current = room;
      
      room.onMessage('queued', (data) => {
        setQueueState(prev => ({
          ...prev,
          connected: true,
          position: data.position,
        }));
      });
      
      room.onMessage('match_found', (data) => {
        setQueueState(prev => ({
          ...prev,
          matchFound: true,
          matchId: data.matchId,
          opponent: data.opponent,
          problem: data.problem,
        }));
      });
      
    } catch (error) {
      console.error('Queue connection failed:', error);
      toast.error('Failed to join queue');
    }
  };
  
  const disconnect = async () => {
    if (roomRef.current) {
      roomRef.current.leave();
      roomRef.current = null;
    }
    setQueueState(initialState);
  };
  
  return { queueState, connect, disconnect };
}
```

---

## Benefits

### BotManagement
- **Better organization**: Each concern in its own file
- **Reusable components**: BotForm, BotList can be reused
- **Easier testing**: Test components independently
- **Better performance**: Smaller components, targeted re-renders

### MatchQueue
- **Cleaner state management**: useQueueConnection hook
- **Better UX**: Dedicated lobby component
- **Easier maintenance**: Smaller, focused components
- **Better testing**: Mock queue connection easily

---

## Migration Steps

### Week 1: BotManagement
- Extract BotList component
- Extract RotationConfig component
- Test both independently

### Week 2: BotManagement
- Extract BotForm component
- Extract BotDeployment component
- Update container component

### Week 3: MatchQueue
- Create useQueueConnection hook
- Extract QueueStatus component
- Extract OpponentCard component

### Week 4: MatchQueue
- Extract MatchLobby component
- Create useMatchTransition hook
- Update container component

### Week 5: Testing & Documentation
- Unit tests for all components
- Integration tests
- Update documentation
- Performance testing

---

## Success Criteria

- ✅ No components over 250 lines
- ✅ All tests passing
- ✅ No behavioral changes
- ✅ Better performance (fewer re-renders)
- ✅ Improved code reusability

---

## Notes

- Use **✅ Zustand store for MatchClient** (already created)
- Consider **React.memo** for performance
- Use **custom hooks** for shared logic
- Keep **accessibility** in mind
- Maintain **responsive design**

