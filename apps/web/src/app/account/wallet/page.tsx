import { WalletPage } from '@/components/wallet/WalletPage'

export default function AccountWalletPage() {
  return <WalletPage scope="personal" endpoint="/api/carits/me/transactions" />
}
