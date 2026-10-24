import { isIP } from 'node:net'

export const EGRESS_ANALYZER_RELAY_PORT = 59080

/** Render the controller-owned relay Secret's Caddyfile; credentials are a separate import. */
export function nodeAnalyzerRelayConfiguration(options: { serverName: string; port: number }): string {
  if (typeof options.serverName !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(options.serverName) || options.serverName.length > 253) {
    throw new Error('Analyzer TLS server name must be a DNS name')
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error('Analyzer node port must be between 1024 and 65535')
  }
  return `{
  admin off
  persist_config off
  auto_https off
  servers {
    protocols h1 h2
  }
}
http://127.0.0.1:${EGRESS_ANALYZER_RELAY_PORT} {
  @classification {
    method POST
    path /analyze
  }
  handle @classification {
    request_body {
      max_size 8MB
    }
    reverse_proxy https://{$NEXUS_DLP_NODE_IP}:${options.port} {
      import /relay/authorization.caddy
      header_up Host ${options.serverName}
      transport http {
        tls_server_name ${options.serverName}
        tls_trust_pool file /relay/analyzer-ca.pem
        dial_timeout 3s
        response_header_timeout 60s
      }
    }
  }
  handle {
    respond 404
  }
}
`
}

/** Render the private node gateway. The verifier is a bcrypt hash, never a plaintext secret. */
export function nodeAnalyzerGatewayConfiguration(options: { bindAddress: string; port: number; passwordHash: string }): string {
  if (!isIP(options.bindAddress) || options.bindAddress.includes(':')) throw new Error('Analyzer bind address must be an IPv4 address')
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error('Invalid analyzer gateway port')
  if (!/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(options.passwordHash)) throw new Error('Analyzer gateway requires a bcrypt verifier')
  return `{
  admin off
  persist_config off
  auto_https off
  servers {
    protocols h1 h2
  }
}
https://:${options.port} {
  bind ${options.bindAddress}
  tls /node-identity/server.pem /node-identity/server-key.pem
  basic_auth {
    classifier ${options.passwordHash}
  }
  @classification {
    method POST
    path /analyze
  }
  handle @classification {
    request_body {
      max_size 8MB
    }
    reverse_proxy 127.0.0.1:59081 {
      header_up -Authorization
    }
  }
  handle {
    respond 404
  }
}
`
}
