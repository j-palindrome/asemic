import { Children, useState } from 'react'
import { useEventListener } from '../utilities/react'
import invariant from 'tiny-invariant'

export default function SlideDeck({
  children,
  currentChild
}: React.PropsWithChildren & { currentChild: number }) {
  invariant(children instanceof Array)

  return (
    <div
      className='flex p-4 font-mono absolute top-0 left-0 h-screen w-screen z-10 text-pink-400'
      style={{
        textShadow: '1px 1px 2px black, -1px -1px 2px black'
      }}>
      <div className='w-full h-full overflow-auto'>
        {children[currentChild]}
      </div>
    </div>
  )
}

export function Citation({
  id,
  children
}: React.PropsWithChildren & { id: string }) {
  return <div>{children}</div>
}

export function Slide({ children }: React.PropsWithChildren) {
  return <>{children}</>
}
