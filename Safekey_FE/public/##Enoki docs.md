##Enoki docs 

Register Enoki Wallets
Initializing

To register Enoki wallets using the wallet-standard, you can use the registerEnokiWallets function. This will add a wallet for each of the configured auth providers. These wallets implement all the standard wallet standard features, and can be interacted with like any other Sui wallet.

Note that Enoki wallets are bound to a specific network, so you will need to re-register your Enoki wallets using an updated client instance and network configuration whenever the targeted network changes. See the React integration section below for how this is handled.

import { registerEnokiWallets } from '@mysten/enoki';

const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });

registerEnokiWallets({
	client: suiClient,
	network: 'testnet',
	apiKey: 'YOUR_PUBLIC_ENOKI_API_KEY',
	providers: {
		google: {
			clientId: 'YOUR_GOOGLE_CLIENT_ID',
		},
		facebook: {
			clientId: 'YOUR_FACEBOOK_CLIENT_ID',
		},
		twitch: {
			clientId: 'YOUR_TWITCH_CLIENT_ID',
		},
	},
});

When the standard:connect feature is called, the Enoki SDK will open a pop-up window to handle the OAuth flow. Once the Oauth flow has completed, the wallet will now be connected, and can be used to sign transactions or personal messages.
React integration

First, set up the dapp-kit providers as described in the dapp-kit docs. Next, create a component to register the Enoki wallets using the registerEnokiWallets function. This component should be rendered before the wallet provider.

import {
	createNetworkConfig,
	SuiClientProvider,
	useSuiClientContext,
	WalletProvider,
} from '@mysten/dapp-kit';
import { isEnokiNetwork, registerEnokiWallets } from '@mysten/enoki';
import { getFullnodeUrl } from '@mysten/sui/client';
import { useEffect } from 'react';

const { networkConfig } = createNetworkConfig({
	testnet: { url: getFullnodeUrl('testnet') },
	mainnet: { url: getFullnodeUrl('mainnet') },
});

function App() {
	return (
		<SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
			<RegisterEnokiWallets />
			<WalletProvider autoConnect>
				<YourApp />
			</WalletProvider>
		</SuiClientProvider>
	);
}

function RegisterEnokiWallets() {
	const { client, network } = useSuiClientContext();

	useEffect(() => {
		if (!isEnokiNetwork(network)) return;

		const { unregister } = registerEnokiWallets({
			apiKey: 'YOUR_PUBLIC_ENOKI_API_KEY',
			providers: {
				// Provide the client IDs for each of the auth providers you want to use:
				google: {
					clientId: 'YOUR_GOOGLE_CLIENT_ID',
				},
				facebook: {
					clientId: 'YOUR_FACEBOOK_CLIENT_ID',
				},
				twitch: {
					clientId: 'YOUR_TWITCH_CLIENT_ID',
				},
			},
			client,
			network,
		});

		return unregister;
	}, [client, network]);

	return null;
}

Enoki TypeScript SDK

Previous Page

Signing in with Enoki

Next Page

Signing in with Enoki

Once Enoki Wallets have been registered via the wallet standard, you can integrate login capabilities with dapp-kit's ConnectButton component or the useConnectWallet hook.
Using the Connect Button

The following example assumes that you have set up the dapp-kit providers and have registered Enoki wallets via the registerEnokiWallets method.

import { ConnectButton } from '@mysten/dapp-kit';

export function YourApp() {
	return <ConnectButton />;
}

When the user taps or clicks the Connect button, the Connect modal will include entries for signing in with each of the configured auth providers. If the user selects one of Auth providers from the list of registered Enoki wallets, the Enoki SDK will automatically handle the OAuth flow in a pop-up window and connect that Enoki wallet as the current active account.
Using custom login buttons

To customize the login experience, you can use the useConnectWallet and useWallets hooks to create your own login buttons:

import { useConnectWallet, useCurrentAccount, useWallets } from '@mysten/dapp-kit';
import { isEnokiWallet, EnokiWallet, AuthProvider } from '@mysten/enoki';
import { type EnokiWallet } from '@mysten/enoki';

function YourLoginComponent() {
	const currentAccount = useCurrentAccount();
	const { connect } = useConnectWallet();

	const wallets = useWallets().filter(isEnokiWallet);
	const walletsByProvider = wallets.reduce(
		(map, wallet) => map.set(wallet.provider, wallet),
		new Map<AuthProvider, EnokiWallet>(),
	);

	const googleWallet = walletsByProvider.get('google');
	const facebookWallet = walletsByProvider.get('facebook');

	if (currentAccount) {
		return <div>Current address: {currentAccount.address}</div>;
	}

	return (
		<>
			{googleWallet ? (
				<button
					onClick={() => {
						connect({ wallet: googleWallet });
					}}
				>
					Sign in with Google
				</button>
			) : null}
			{facebookWallet ? (
				<button
					onClick={() => {
						connect({ wallet: facebookWallet });
					}}
				>
					Sign in with Facebook
				</button>
			) : null}
		</>
	);
}

Removing Enoki wallets from the ConnectButton modal

If your app supports both Enoki and normal wallets, and you have implemented custom login buttons, you can hide the Enoki wallets from the ConnectButton modal by using the walletFilter prop of the ConnectButton component:

import { ConnectButton } from '@mysten/dapp-kit';
import { isEnokiWallet } from '@mysten/enoki';

export function YourApp() {
	return <ConnectButton walletFilter={(wallet) => !isEnokiWallet(wallet)} />;
}

Register Enoki Wallets

Previous Page

Signing Transactions

Next Page

Signing Transactions

The Enoki SDK uses the wallet-standard to allow signing transactions to be handle the same way it is done with other wallets. You can use the useSignAndExecuteTransaction hook from dapp-kit to sign and execute transactions
Example

Consider the following code example. Unseen here, the SuiClientProvider wraps the root of this app and the Enoki wallets are already registered through the wallet standard. Doing this enables the wallet related hooks from dapp-kit to work with Enoki.

When the user taps or clicks the Sign and execute transaction button, if the currently connected wallet is an Enoki wallet, the Enoki SDK will automatically generate a signature for the transaction, before it is executed with dapp-kit.

import { Transaction } from '@mysten/sui/transactions';
import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';

function Demo() {
	const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();

	async function handleButtonClick() {
		const transaction = new Transaction();
		// Add some commands to the transaction...

		// Executes the transaction using the currently connected wallet
		const { digest } = await signAndExecuteTransaction({
			transaction,
		});
	}

	return <button onClick={handleButtonClick}>Sign and execute transaction</button>;
}

Unlike other wallets, signing does not require confirmation to approve the transaction. In a production app, you should provide logic that informs the user they are performing a transaction and allow them to cancel it if it was unintended.

Signing in with Enoki

Previous Page

Sponsored Transactions

Next Page