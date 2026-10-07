import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * "Connect Klap": the user signs in with their Klap account (OAuth 2.1 + PKCE).
 *
 * Klap's authorization server (Supabase Auth) supports open dynamic client
 * registration, so the credential carries no client ID or secret. n8n's OAuth2
 * credential handles it when `useDynamicClientRegistration` is true: on
 * "Connect", n8n reads Klap API's protected resource metadata (RFC 9728) at
 * `serverUrl`, follows it to the authorization server's metadata (RFC 8414),
 * registers itself as a public client (`token_endpoint_auth_method: none`) and
 * stores the negotiated client ID, endpoints and grant type (`pkce`) on the
 * credential. Refreshes send `client_id` in the body without a secret.
 *
 * Requires n8n 2.12.0 or later (RFC 9728 and RFC 8414 path discovery).
 */
export class KlapOAuth2Api implements ICredentialType {
	name = 'klapOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Klap OAuth2 API';

	icon: Icon = { light: 'file:../icons/klap.svg', dark: 'file:../icons/klap.dark.svg' };

	documentationUrl = 'https://github.com/ziggapp/n8n-nodes-klap?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Use Dynamic Client Registration',
			name: 'useDynamicClientRegistration',
			type: 'hidden',
			default: true,
		},
		{
			// Klap API, the protected resource. Its metadata names Klap's
			// authorization server and the scopes to request.
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'hidden',
			default: 'https://api.klap.app/mcp',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: 'openid email profile',
		},
	];
}
