interface BrandLockupProps {
  compact?: boolean
}

export function BrandLockup({ compact = false }: BrandLockupProps) {
  return (
    <span className="inline-flex min-w-0 items-center gap-3">
      <img
        className={compact ? 'h-8 w-8 rounded-lg' : 'h-11 w-11 rounded-xl'}
        src="/favicon.svg"
        alt=""
      />
      <span className={compact ? 'text-lg font-semibold tracking-tight text-[#161616]' : 'text-2xl font-semibold tracking-tight text-[#161616]'}>
        Tavro AI
      </span>
    </span>
  )
}
