'use client'

const SLIDES = [
  { src: '/landing/worldcup-draw.jpg', tag: 'The prize', title: 'The FIFA World Cup' },
  { src: '/landing/metlife-stadium.jpg', tag: 'The stage', title: 'MetLife Stadium, New York' },
  { src: '/landing/restaurant.jpg', tag: 'The table', title: 'Dinner after the final whistle' },
  { src: '/landing/worldcup-fans.png', tag: 'The crew', title: 'Colours on, kickoff soon' },
  { src: '/landing/fans-bar.png', tag: 'The watch party', title: 'Every screen in the city' },
  { src: '/landing/friends-toast.jpg', tag: 'The celebration', title: 'To the win — and the food' },
  { src: '/landing/friends-dinner.jpg', tag: 'The long table', title: 'New friends, one reservation' },
  { src: '/landing/friends-terrace.jpg', tag: 'The morning after', title: 'Brunch with a view' },
]

function SlideCard({ slide, offset }: { slide: (typeof SLIDES)[number]; offset: boolean }) {
  return (
    <figure
      className={`group/card relative w-[230px] shrink-0 overflow-hidden rounded-2xl bg-[#101014] shadow-[0_4px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.5)] sm:w-[290px] lg:w-[330px] ${offset ? 'mt-10' : 'mb-10'}`}
    >
      <img
        src={slide.src}
        alt={slide.title}
        draggable={false}
        loading="lazy"
        className="aspect-[4/5] w-full object-cover transition-transform duration-700 ease-out group-hover/card:scale-105"
      />
      <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 pb-4 pt-14">
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#FFB07A]">{slide.tag}</span>
        <span className="mt-0.5 block text-[14px] font-semibold text-white sm:text-[15px]">{slide.title}</span>
      </figcaption>
    </figure>
  )
}

/**
 * Infinite horizontal showcase: two identical track copies inside one
 * translateX(-50%) loop, so the seam is invisible. Hover pauses the belt;
 * reduced motion stops it and lets the strip scroll by touch instead.
 */
export default function ShowcaseMarquee() {
  return (
    <div
      className="landing-marquee-pausable relative overflow-hidden motion-reduce:overflow-x-auto"
      style={{
        maskImage: 'linear-gradient(to right, transparent, #000 5%, #000 95%, transparent)',
        WebkitMaskImage: 'linear-gradient(to right, transparent, #000 5%, #000 95%, transparent)',
      }}
    >
      <div className="landing-marquee flex w-max">
        {[0, 1].map((copy) => (
          <div key={copy} aria-hidden={copy === 1} className="flex gap-5 pr-5 sm:gap-6 sm:pr-6">
            {SLIDES.map((s, i) => (
              <SlideCard key={s.src} slide={s} offset={i % 2 === 1} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
