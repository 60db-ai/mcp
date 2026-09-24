# QLabs MCP Server - Testing Guide

This guide covers testing the QLabs MCP Server including unit tests, integration tests, and manual testing with the MCP Inspector.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [MCP Inspector Testing](#mcp-inspector-testing)
3. [Claude Desktop Integration](#claude-desktop-integration)
4. [Programmatic Testing](#programmatic-testing)
5. [Evaluation Testing](#evaluation-testing)
6. [Common Test Scenarios](#common-test-scenarios)

## Prerequisites

Before testing, ensure you have:

1. **Valid API credentials**:
   ```bash
   export QLABS_API_KEY=sk_your_api_key_here
   # OR
   export QLABS_JWT_TOKEN=your_jwt_token_here
   ```

2. **Built the server**:
   ```bash
   npm run build
   ```

3. **Access to QLabs API**:
   - Local instance: `http://localhost:3000`
   - Staging: `https://staging-api.qlabs.com`
   - Production: `https://api.qlabs.com`

## MCP Inspector Testing

The MCP Inspector is the official tool for testing MCP servers interactively.

### Installation

```bash
npm install -g @modelcontextprotocol/inspector
```

### Running the Inspector

```bash
# From the project directory
mcp-inspector node dist/index.js

# With environment variables
QLABS_API_KEY=sk_your_key mcp-inspector node dist/index.js

# Or set environment first
export QLABS_API_KEY=sk_your_key
mcp-inspector node dist/index.js
```

### Inspector UI

The Inspector provides:
- **Tools List**: View all available tools
- **Tool Invocation**: Call tools with parameters
- **Response Viewing**: See formatted responses
- **Error Handling**: Debug error messages

### Test Commands in Inspector

#### 1. List Available Tools

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

#### 2. List Voices

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "qlabs_list_voices",
    "arguments": {
      "language": "en-US",
      "limit": 5,
      "response_format": "markdown"
    }
  }
}
```

#### 3. Synthesize Speech

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "qlabs_tts_synthesize",
    "arguments": {
      "text": "Hello, this is a test of the QLabs MCP server.",
      "voice_id": "voice_default_en",
      "response_format": "markdown"
    }
  }
}
```

#### 4. Get Usage Statistics

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "qlabs_get_usage_stats",
    "arguments": {
      "response_format": "json"
    }
  }
}
```

## Claude Desktop Integration

### Configuration File

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

Add the QLabs MCP server:

```json
{
  "mcpServers": {
    "qlabs": {
      "command": "node",
      "args": [
        "/absolute/path/to/qlabs-mcp-server/dist/index.js"
      ],
      "env": {
        "QLABS_API_KEY": "sk_your_api_key_here",
        "QLABS_API_BASE_URL": "https://api.qlabs.com"
      }
    }
  }
}
```

### Using with Claude Desktop

1. **Restart Claude Desktop** after updating the config
2. **Start a new chat** - the QLabs tools will be available
3. **Test with prompts**:
   - "List all available English voices"
   - "Synthesize 'Hello world' using a female voice"
   - "What's my current usage statistics?"
   - "Show me my recent TTS generations"

### Example Conversations

```
User: List all public English voices

Claude: I'll list the public English voices for you.
[Uses qlabs_list_voices tool]

User: Can you synthesize "Hello, this is a test" with the first voice?

Claude: I'll synthesize that text for you.
[Uses qlabs_tts_synthesize tool with the first voice ID]
```

## Programmatic Testing

### Python Test Script

```python
import json
import subprocess
import sys

class MCPClient:
    def __init__(self, command):
        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=0
        )

    def call_tool(self, name, arguments):
        request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments
            }
        }

        self.process.stdin.write(json.dumps(request) + "\n")
        response = json.loads(self.process.stdout.readline())
        return response

# Usage
client = MCPClient(["node", "dist/index.js"])

# Test listing voices
result = client.call_tool("qlabs_list_voices", {
    "limit": 5,
    "language": "en-US",
    "response_format": "json"
})

print(json.dumps(result, indent=2))
```

### Node.js Test Script

```javascript
import { spawn } from 'child_process';
import { createInterface } from 'readline';

class MCPClient {
  constructor(command) {
    this.process = spawn(command[0], command.slice(1), {
      stdio: ['pipe', 'pipe', 'inherit']
    });
    this.id = 0;
  }

  async callTool(name, arguments) {
    const request = {
      jsonrpc: '2.0',
      id: ++this.id,
      method: 'tools/call',
      params: { name, arguments }
    };

    this.process.stdin.write(JSON.stringify(request) + '\n');

    const response = await this._readLine();
    return JSON.parse(response);
  }

  async _readLine() {
    const rl = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      return line;
    }
  }
}

// Usage
const client = new MCPClient(['node', 'dist/index.js']);

async function test() {
  // Test usage stats
  const result = await client.callTool('qlabs_get_usage_stats', {
    response_format: 'json'
  });

  console.log(JSON.stringify(result, null, 2));
}

test().catch(console.error);
```

## Evaluation Testing

Create an evaluation file to test the server's capabilities:

### Evaluation File: `evaluation.xml`

```xml
<?xml version="1.0"?>
<evaluation>
  <qa_pair>
    <question>How many English (en-US) voices are available in the system?</question>
    <answer>Obtain the exact count by calling qlabs_list_voices with language="en-US" and checking the total field.</answer>
  </qa_pair>
  <qa_pair>
    <question>What is my current TTS credit usage for this billing period?</question>
    <answer>Use qlabs_get_usage_stats and check the tts_credits_used field.</answer>
  </qa_pair>
  <qa_pair>
    <question>List all meetings with status "completed" from the last 30 days.</question>
    <answer>Call qlabs_list_meetings with status="completed" and appropriate date filters.</answer>
  </qa_pair>
</evaluation>
```

### Running Evaluations

```bash
# Install evaluation script dependencies
pip install anthropic mcp

# Run evaluation
python scripts/evaluation.py \
  -t stdio \
  -c node \
  -a dist/index.js \
  -e QLABS_API_KEY=sk_your_key \
  evaluation.xml
```

## Common Test Scenarios

### Scenario 1: Voice Cloning Workflow

```javascript
// 1. List available voices
qlabs_list_voices({ language: "en-US", limit: 10 })

// 2. Get details of a specific voice
qlabs_get_voice({ id: "voice_abc123" })

// 3. Create a cloned voice
qlabs_create_voice({
  name: "My Custom Voice",
  sample_audio_url: "https://example.com/sample.mp3",
  language: "en-US"
})

// 4. List voices again to verify
qlabs_list_voices({ is_clone: true })
```

### Scenario 2: TTS Generation Workflow

```javascript
// 1. Check available credits
qlabs_get_usage_stats()

// 2. Synthesize speech
qlabs_tts_synthesize({
  text: "This is a test of the text-to-speech system.",
  voice_id: "voice_abc123",
  speed: 1.0,
  output_format: "mp3"
})

// 3. Get TTS history
qlabs_tts_logs({ limit: 5 })

// 4. Get specific generation details
qlabs_tts_get({ id: "tts_xyz789" })
```

### Scenario 3: STT Transcription Workflow

```javascript
// 1. Transcribe audio
qlabs_stt_transcribe({
  audio_url: "https://example.com/meeting.mp3",
  language: "en-US",
  diarization: true,
  punctuation: true
})

// 2. Get transcription history
qlabs_stt_logs({ limit: 10 })

// 3. Get specific transcription
qlabs_stt_get({ id: "stt_def456" })
```

### Scenario 4: Workspace Collaboration

```javascript
// 1. List workspaces
qlabs_list_workspaces()

// 2. Create a workspace
qlabs_create_workspace({
  name: "Marketing Team",
  description: "Voice assets for marketing campaigns"
})

// 3. Get workspace members
qlabs_get_workspace_members({ workspace_id: "workspace_123" })

// 4. List workspace-specific voices
qlabs_list_voices({ workspace_id: "workspace_123" })
```

### Scenario 5: Meeting Management

```javascript
// 1. Create a meeting
qlabs_create_meeting({
  title: "Weekly Standup"
})

// 2. List meetings
qlabs_list_meetings({
  status: "completed",
  limit: 10
})

// 3. Get meeting details
qlabs_get_meeting({ id: "meeting_abc123" })

// 4. Get usage stats
qlabs_get_usage_stats()
```

### Scenario 6: 60DB Dictionary Management

```javascript
// 1. List dictionary entries
qlabs_60db_list_dictionary({ scope: "all" })

// 2. Add a dictionary entry
qlabs_60db_add_dictionary({
  phrase: "QLabs",
  replacement: "Cue Labs",
  scope: "team"
})

// 3. Verify entry was added
qlabs_60db_list_dictionary({ search: "QLabs" })
```

### Scenario 7: Billing and Subscription

```javascript
// 1. List available plans
qlabs_list_plans()

// 2. Get current subscription
qlabs_get_subscription()

// 3. List recent invoices
qlabs_list_invoices({ limit: 10 })

// 4. Get specific invoice
qlabs_get_invoice({ id: "inv_abc123" })
```

### Scenario 8: Music Generation Workflow

```javascript
// 1. Browse voices
sixtydb_music_list_voices({ search: "Devendra" })

// 2. Create a song (simple mode)
sixtydb_music_create_song({ prompt: "An upbeat pop song about summer road trips" })

// 3. Poll status until succeeded/failed
sixtydb_music_get_song({ song_id: "song_abc123" })

// 4. List songs
sixtydb_music_list_songs({ status: "ready", limit: 10 })

// 5. Download the finished MP3
sixtydb_music_download_song({
  song_id: "song_abc123",
  output_path: "/absolute/path/to/song.mp3"
})
```

### Scenario 9: Dialer Workflow (numbers require `confirm: true` to spend money)

```javascript
// 1. Check provisioning status
sixtydb_dialer_get_status()

// 2. Search available numbers
sixtydb_dialer_search_numbers()

// 3. Attempt to buy WITHOUT confirm — returns a cost/KYC warning, does not call the API
sixtydb_dialer_buy_number({ number: "+14155551234" })

// 4. Buy for real (requires approved KYC in the 60db app, Dialer -> KYC)
sixtydb_dialer_buy_number({ number: "+14155551234", confirm: true })

// 5. List owned numbers and call history
sixtydb_dialer_list_numbers()
sixtydb_dialer_list_calls({ limit: 10 })

// 6. Check billing usage
sixtydb_dialer_get_usage()
```

## Performance Testing

### Load Testing Script

```javascript
import { spawn } from 'child_process';

async function testLoad(concurrency, iterations) {
  const promises = [];

  for (let i = 0; i < concurrency; i++) {
    promises.push(runClient(iterations));
  }

  const results = await Promise.all(promises);
  console.log('Load test complete:', results);
}

async function runClient(iterations) {
  const client = new MCPClient(['node', 'dist/index.js']);
  const start = Date.now();

  for (let i = 0; i < iterations; i++) {
    await client.callTool('qlabs_list_voices', { limit: 10 });
  }

  return {
    duration: Date.now() - start,
    iterations,
    avgTime: (Date.now() - start) / iterations
  };
}

testLoad(10, 100); // 10 concurrent clients, 100 iterations each
```

## Debugging

### Enable Verbose Logging

Set environment variable:
```bash
export DEBUG=qlabs-mcp:*
```

### Common Issues and Solutions

| Issue | Solution |
|-------|----------|
| "Authentication required" | Check QLABS_API_KEY is set and valid |
| "Rate limit exceeded" | Wait before retry or increase rate limit |
| "Voice not found" | Verify voice ID is correct |
| "Insufficient credits" | Check usage stats and add credits |
| Process exits immediately | Check stderr for error messages |
| No tools available | Verify build completed successfully |

### Testing Checklist

- [ ] Server starts without errors
- [ ] Can list available tools
- [ ] Can call qlabs_list_voices
- [ ] Can call qlabs_get_usage_stats
- [ ] Can call qlabs_tts_synthesize (with credits)
- [ ] Can call qlabs_stt_transcribe (with audio URL)
- [ ] Pagination works correctly
- [ ] JSON and Markdown formats both work
- [ ] Error messages are clear and actionable
- [ ] Claude Desktop integration works

## Support

For testing issues:
1. Check logs in stderr/stdout
2. Verify environment variables
3. Test with MCP Inspector first
4. Review API credentials
5. Contact QLabs support: support@qlabs.com
