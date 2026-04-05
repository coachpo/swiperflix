
import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const VideoSlider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-[2px] w-full grow overflow-hidden rounded-full bg-white/20">
      <SliderPrimitive.Range className="absolute h-full bg-white/60" />
    </SliderPrimitive.Track>
    {/* Removed Thumb */}
  </SliderPrimitive.Root>
))
VideoSlider.displayName = SliderPrimitive.Root.displayName

export { VideoSlider }
