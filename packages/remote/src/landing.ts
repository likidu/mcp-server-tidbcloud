/**
 * Landing page HTML for TiDB Cloud MCP Server
 */

export function getLandingPageHtml(baseUrl: string): string {
  const mcpUrl = `${baseUrl}/mcp`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TiDB Cloud MCP Server</title>
    <style>
        :root {
            --primary-red: #E30C1B;
            --primary-red-dark: #B80A15;
            --dark-bg: #172133;
            --darker-bg: #0F1724;
            --text-primary: #FFFFFF;
            --text-secondary: #A0AEC0;
            --border-color: #2D3748;
            --card-bg: #1A2332;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: var(--darker-bg);
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem 1.5rem;
        }

        /* Header */
        header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1rem 0;
            border-bottom: 1px solid var(--border-color);
            margin-bottom: 3rem;
        }

        .logo-section {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .logo {
            width: 40px;
            height: 40px;
        }

        .logo-text {
            font-size: 1.25rem;
            font-weight: 600;
        }

        .version {
            font-size: 0.75rem;
            color: var(--text-secondary);
            background: var(--card-bg);
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            margin-left: 0.5rem;
        }

        .header-links {
            display: flex;
            gap: 1rem;
        }

        .header-links a {
            color: var(--text-secondary);
            text-decoration: none;
            font-size: 0.875rem;
            transition: color 0.2s;
        }

        .header-links a:hover {
            color: var(--text-primary);
        }

        /* Hero */
        .hero {
            text-align: center;
            margin-bottom: 3rem;
        }

        .hero h1 {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, var(--text-primary) 0%, var(--primary-red) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .hero p {
            font-size: 1.25rem;
            color: var(--text-secondary);
            max-width: 600px;
            margin: 0 auto;
        }

        /* MCP URL Box */
        .mcp-url-box {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }

        .mcp-url-label {
            font-size: 0.875rem;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
        }

        .mcp-url {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .mcp-url code {
            flex: 1;
            background: var(--darker-bg);
            padding: 0.75rem 1rem;
            border-radius: 6px;
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
            font-size: 0.9rem;
            color: var(--primary-red);
            overflow-x: auto;
        }

        .copy-btn {
            background: var(--primary-red);
            color: white;
            border: none;
            padding: 0.75rem 1rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
            transition: background 0.2s;
            white-space: nowrap;
        }

        .copy-btn:hover {
            background: var(--primary-red-dark);
        }

        /* Info Box */
        .info-box {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-left: 4px solid var(--primary-red);
            border-radius: 8px;
            padding: 1.25rem;
            margin-bottom: 2rem;
        }

        .info-box h3 {
            font-size: 1rem;
            margin-bottom: 0.5rem;
        }

        .info-box p {
            color: var(--text-secondary);
            font-size: 0.9rem;
        }

        /* Security Warning */
        .security-warning {
            background: rgba(234, 179, 8, 0.1);
            border: 1px solid rgba(234, 179, 8, 0.3);
            border-left: 4px solid #EAB308;
            border-radius: 8px;
            padding: 1.25rem;
            margin-bottom: 2rem;
        }

        .security-warning h3 {
            font-size: 1rem;
            margin-bottom: 0.75rem;
            color: #EAB308;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .security-warning p {
            color: var(--text-secondary);
            font-size: 0.9rem;
            margin-bottom: 0.75rem;
        }

        .security-warning ul {
            color: var(--text-secondary);
            font-size: 0.85rem;
            padding-left: 1.25rem;
            margin: 0;
        }

        .security-warning li {
            margin-bottom: 0.35rem;
        }

        .security-warning a {
            color: #EAB308;
            text-decoration: none;
        }

        .security-warning a:hover {
            text-decoration: underline;
        }

        /* Tools Section */
        .tools-section {
            margin-bottom: 3rem;
        }

        .tools-section h2 {
            font-size: 1.5rem;
            margin-bottom: 1.5rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid var(--border-color);
        }

        .tool-category {
            margin-bottom: 2rem;
        }

        .tool-category h3 {
            font-size: 1rem;
            color: var(--primary-red);
            margin-bottom: 1rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .tool-list {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }

        .tool-item {
            display: flex;
            align-items: baseline;
            gap: 1rem;
            padding: 0.75rem 1rem;
            background: var(--card-bg);
            border-radius: 6px;
            border: 1px solid var(--border-color);
        }

        .tool-name {
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
            font-size: 0.875rem;
            color: var(--primary-red);
            white-space: nowrap;
        }

        .tool-desc {
            color: var(--text-secondary);
            font-size: 0.875rem;
        }

        /* Footer */
        footer {
            text-align: center;
            padding: 2rem 0;
            border-top: 1px solid var(--border-color);
            color: var(--text-secondary);
            font-size: 0.875rem;
        }

        footer a {
            color: var(--primary-red);
            text-decoration: none;
        }

        footer a:hover {
            text-decoration: underline;
        }

        /* Responsive */
        @media (max-width: 600px) {
            .hero h1 {
                font-size: 1.75rem;
            }

            .hero p {
                font-size: 1rem;
            }

            .mcp-url {
                flex-direction: column;
            }

            .mcp-url code {
                width: 100%;
            }

            .copy-btn {
                width: 100%;
            }

            .tool-item {
                flex-direction: column;
                gap: 0.25rem;
            }

            header {
                flex-direction: column;
                gap: 1rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="logo-section">
                <svg class="logo" viewBox="-16.71 0 249.42 249.42" xmlns="http://www.w3.org/2000/svg">
                    <polygon fill="#e30c34" points="0 62.35 0 187.06 108 249.41 216 187.06 216 62.35 108 0 0 62.35" />
                    <polygon fill="#fff" points="107.94 41.63 36.21 83.04 36.21 124.45 72.08 103.73 72.08 187.11 107.94 207.78 107.94 207.78 107.94 83.03 143.79 62.33 107.94 41.63" />
                    <polygon fill="#fff" points="144 103.95 144 187.06 180 166.28 180 83.14 144 103.95" />
                </svg>
                <span class="logo-text">TiDB Cloud MCP Server</span>
                <span class="version">v0.1.0</span>
            </div>
            <div class="header-links">
                <a href="https://github.com/likidu/mcp-server-tidbcloud" target="_blank">GitHub</a>
                <a href="https://tidbcloud.com" target="_blank">TiDB Cloud</a>
            </div>
        </header>

        <section class="hero">
            <h1>Manage TiDB Cloud with Natural Language</h1>
            <p>Connect your AI assistant to TiDB Cloud. Create clusters, manage branches, and run SQL queries through simple conversations.</p>
        </section>

        <div class="mcp-url-box">
            <div class="mcp-url-label">MCP Server URL</div>
            <div class="mcp-url">
                <code id="mcpUrl">${mcpUrl}</code>
                <button class="copy-btn" onclick="copyUrl()">Copy</button>
            </div>
        </div>

        <div class="info-box">
            <h3>Quick Start</h3>
            <p>Add this server URL to your MCP-compatible client (like Claude Desktop) to start managing your TiDB Cloud resources with natural language.</p>
        </div>

        <div class="security-warning">
            <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                Security Notice
            </h3>
            <p>This MCP server grants powerful database management capabilities. Always review and authorize actions requested by the LLM before execution.</p>
            <ul>
                <li>Intended for local development and IDE integrations</li>
                <li>Not recommended for production environments without proper OAuth setup</li>
                <li>Ensure only authorized users have access to your MCP server URL</li>
                <li>Monitor usage and regularly audit access to your API keys</li>
            </ul>
            <p style="margin-top: 0.75rem; margin-bottom: 0;"><a href="https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices" target="_blank">Read MCP Security Best Practices →</a></p>
        </div>

        <section class="tools-section">
            <h2>Available Tools</h2>

            <div class="tool-category">
                <h3>Cluster Management</h3>
                <div class="tool-list">
                    <div class="tool-item">
                        <span class="tool-name">tidbcloud_list_clusters</span>
                        <span class="tool-desc">List all TiDB Cloud Serverless clusters</span>
                    </div>
                    <div class="tool-item">
                        <span class="tool-name">tidbcloud_get_cluster</span>
                        <span class="tool-desc">Get details of a specific cluster</span>
                    </div>
                    <div class="tool-item">
                        <span class="tool-name">tidbcloud_create_cluster</span>
                        <span class="tool-desc">Create a new Serverless cluster</span>
                    </div>
                    <div class="tool-item">
                        <span class="tool-name">tidbcloud_update_cluster</span>
                        <span class="tool-desc">Update cluster configuration</span>
                    </div>
                    <div class="tool-item">
                        <span class="tool-name">tidbcloud_delete_cluster</span>
                        <span class="tool-desc">Delete a cluster</span>
                    </div>
                </div>
            </div>

            <div class="tool-category">
                <h3>Branch Management</h3>
                <div class="tool-list">
                    <div class="tool-item">
                        <span class="tool-name">tidbcloud_list_branches</span>
                        <span class="tool-desc">List all branches for a cluster</span>
                    </div>
                    <div class="tool-item">
                        <span class="tool-name">tidbcloud_get_branch</span>
                        <span class="tool-desc">Get details of a specific branch</span>
                    </div>
                    <div class="tool-item">
                        <span class="tool-name">tidbcloud_create_branch</span>
                        <span class="tool-desc">Create a new branch for development or testing</span>
                    </div>
                    <div class="tool-item">
                        <span class="tool-name">tidbcloud_delete_branch</span>
                        <span class="tool-desc">Delete a branch</span>
                    </div>
                </div>
            </div>

            <div class="tool-category">
                <h3>Database Operations</h3>
                <div class="tool-list">
                    <div class="tool-item">
                        <span class="tool-name">show_databases</span>
                        <span class="tool-desc">List all databases in the cluster</span>
                    </div>
                    <div class="tool-item">
                        <span class="tool-name">show_tables</span>
                        <span class="tool-desc">List all tables in a database</span>
                    </div>
                    <div class="tool-item">
                        <span class="tool-name">db_query</span>
                        <span class="tool-desc">Execute read-only SQL queries</span>
                    </div>
                    <div class="tool-item">
                        <span class="tool-name">db_execute</span>
                        <span class="tool-desc">Execute SQL statements (INSERT, UPDATE, DDL)</span>
                    </div>
                    <div class="tool-item">
                        <span class="tool-name">db_create_user</span>
                        <span class="tool-desc">Create a new database user</span>
                    </div>
                    <div class="tool-item">
                        <span class="tool-name">db_remove_user</span>
                        <span class="tool-desc">Remove a database user</span>
                    </div>
                </div>
            </div>

            <div class="tool-category">
                <h3>Regions</h3>
                <div class="tool-list">
                    <div class="tool-item">
                        <span class="tool-name">tidbcloud_list_regions</span>
                        <span class="tool-desc">List available cloud regions for cluster creation</span>
                    </div>
                </div>
            </div>
        </section>

        <footer>
            <p>Built with <a href="https://modelcontextprotocol.io" target="_blank">Model Context Protocol</a> for <a href="https://tidbcloud.com" target="_blank">TiDB Cloud</a></p>
        </footer>
    </div>

    <script>
        function copyUrl() {
            const url = document.getElementById('mcpUrl').textContent;
            navigator.clipboard.writeText(url).then(() => {
                const btn = document.querySelector('.copy-btn');
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            });
        }
    </script>
    <script>
        window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    </script>
    <script defer src="/_vercel/insights/script.js"></script>
</body>
</html>`;
}
