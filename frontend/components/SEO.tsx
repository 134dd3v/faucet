import { DefaultSeo } from 'next-seo'

export function SEO() {
  return (
    <DefaultSeo
      defaultTitle='Rage Trade'
      titleTemplate='%s — Rage Trade'
      description='The most liquid, composable, and only omnichain ETH Perpetual Swap'
      canonical='https://faucet.rage.trade'
      openGraph={{
        url: 'https://faucet.rage.trade',
        title: 'Rage Trade',
        description: 'The most liquid, composable, and only omnichain ETH Perpetual Swap',
        site_name: 'rage_trade',
        images: [
          {
            url: 'https://www.rage.trade/rage_og_image.jpg',
            width: 1452,
            height: 756,
            alt: 'Rage Trade',
            type: 'image/jpeg'
          }
        ]
      }}
      twitter={{
        handle: '@rage_trade',
        site: '@rage_trade',
        cardType: 'summary_large_image'
      }}
    />
  )
}
