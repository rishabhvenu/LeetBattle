Bot Service (scaffold)

Environment variables (examples):
- BOTS_ENABLED=true
- BOT_COUNT=30
- BOT_SERVICE_SECRET=change_me
- COLYSEUS_URL=ws://colyseus:2567

Redis channels/keys:
- bots:available (list of JSON: {userId, rating})
- bots:requests (list push-only; bot service pops and allocates)

Lifecycle:
- Maintain N bot identities, push availability to bots:available when idle
- Pop from bots:requests to accelerate allocation under demand


