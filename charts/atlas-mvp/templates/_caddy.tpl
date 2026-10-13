{{- define "atlas.caddy" -}}
{
  auto_https off
  default_sni {{ (urlParse .Values.gateway.webuiOrigin).host }}
  servers {
    protocols h1 h2
  }
  admin off
}
:80 {
  handle /caddy-health {
    respond "ok" 200
  }
  handle {
    redir {{ .Values.gateway.webuiOrigin }}{uri} 308
  }
}
{{ .Values.gateway.webuiOrigin }} {
  tls /etc/atlas-tls/tls.crt /etc/atlas-tls/tls.key
  reverse_proxy sudowork-webui:26808
}
{{ .Values.gateway.mossOrigin }} {
  tls /etc/atlas-tls/tls.crt /etc/atlas-tls/tls.key
  reverse_proxy moss-server:{{ .Values.moss.port }}
}
{{ if and .Values.router.enabled .Values.router.expose }}
{{ .Values.gateway.routerOrigin }} {
  tls /etc/atlas-tls/tls.crt /etc/atlas-tls/tls.key
  reverse_proxy sudorouter:3000
}
{{ end }}
{{- end -}}
