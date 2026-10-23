"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import "./footer-mascot.css";

const body =
  "M301 38C243 34 209 72 189 119C169 166 164 216 138 257C125 278 105 296 87 322C145 343 217 344 298 344C381 344 450 341 506 322C477 300 451 272 434 239C412 197 413 154 393 106C376 64 345 40 301 38Z";
const orbitBack = "M95 216C30 163 88 131 214 151C340 171 504 226 545 278";
const orbitFront = "M545 278C591 335 455 347 294 301C179 268 117 239 95 216";
const ease = [0.45, 0, 0.25, 1] as const;
const tiles = [
  { angle: 15, type: "stethoscope", x: 245, y: 78 },
  { angle: -15, type: "record", x: 112, y: 207 },
  { angle: 13, type: "heart", x: 1084, y: 85 },
  { angle: -17, type: "image", x: 1230, y: 209 },
];

/** Layered vector artwork: back orbit → sculpted body → front orbit → card → hands. */
export function FooterMascot() {
  const uid = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const url = (name: string) => `url(#${uid}-${name})`;
  const loop = (duration: number, delay = 0) => ({
    delay,
    duration,
    ease,
    repeat: Number.POSITIVE_INFINITY,
  });
  const orbitMotion = reduced
    ? undefined
    : { rotate: [-2, 2.5, -2], y: [0, -4, 0] };

  return (
    <>
      <div aria-hidden="true" className="medix-footer-sky">
        <div className="medix-footer-atmosphere" />
        <svg
          className="medix-footer-constellation"
          fill="none"
          viewBox="0 0 1440 380"
        >
          <defs>
            <linearGradient id={`${uid}-glass`} x1="0" x2="1" y1="0" y2="1">
              <stop stopColor="white" stopOpacity=".95" />
              <stop offset="1" stopColor="#e4edff" stopOpacity=".58" />
            </linearGradient>
            <linearGradient id={`${uid}-icon`} x1="0" x2=".8" y1="0" y2="1">
              <stop stopColor="#84baff" />
              <stop offset="1" stopColor="#6576f0" />
            </linearGradient>
            <filter
              height="240%"
              id={`${uid}-tile-shadow`}
              width="220%"
              x="-60%"
              y="-60%"
            >
              <feDropShadow
                dx="0"
                dy="12"
                floodColor="#6da4e8"
                floodOpacity=".12"
                stdDeviation="14"
              />
            </filter>
          </defs>
          <path
            d="M133 247C253 12 394 135 541 248M887 245C1019 133 1154 82 1291 234"
            stroke="#92caff"
            strokeDasharray="7 10"
            strokeOpacity=".48"
            strokeWidth="2"
          />
          {tiles.map(({ x, y, angle, type }, index) => (
            <g key={type} transform={`translate(${x} ${y})`}>
              <motion.g
                animate={
                  reduced
                    ? undefined
                    : { rotate: [angle, angle - 4, angle], y: [0, -11, 0] }
                }
                initial={{ rotate: angle }}
                transition={loop(6.8 + index * 0.7, -index * 1.8)}
              >
                <rect
                  fill={url("glass")}
                  filter={url("tile-shadow")}
                  height="102"
                  rx="25"
                  stroke="white"
                  strokeWidth="1.6"
                  width="102"
                  x="-51"
                  y="-51"
                />
                <g
                  stroke={url("icon")}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="5"
                >
                  {type === "stethoscope" && (
                    <>
                      <path d="M-22-22v15a19 19 0 0 0 38 0v-15M-22-22h7m31 0H9M-3 12v9a13 13 0 0 0 26 0v-4" />
                      <circle cx="24" cy="10" fill="#edf6ff" r="7" />
                    </>
                  )}
                  {type === "record" && (
                    <>
                      <rect
                        fill={url("icon")}
                        height="54"
                        rx="8"
                        stroke="none"
                        width="40"
                        x="-20"
                        y="-27"
                      />
                      <path
                        d="M-10-13h20M-10 0h20M-10 13H5"
                        stroke="#e9f5ff"
                        strokeWidth="4"
                      />
                    </>
                  )}
                  {type === "heart" && (
                    <>
                      <path
                        d="M0 29C-13 20-34 1-29-16C-24-33-7-32 0-20C9-33 26-30 30-16C36 1 13 22 0 29Z"
                        fill={url("icon")}
                        stroke="none"
                      />
                      <path
                        d="M-20 0h10l6-11L3 14l7-15h11"
                        stroke="#e9f8ff"
                        strokeWidth="3.5"
                      />
                    </>
                  )}
                  {type === "image" && (
                    <>
                      <rect
                        fill={url("icon")}
                        height="48"
                        rx="9"
                        stroke="none"
                        width="52"
                        x="-26"
                        y="-24"
                      />
                      <circle
                        cx="-12"
                        cy="-10"
                        fill="#e4f6ff"
                        r="5"
                        stroke="none"
                      />
                      <path
                        d="M-18 15-5 1l8 7 10-14 8 21Z"
                        fill="#edfaff"
                        stroke="none"
                      />
                    </>
                  )}
                </g>
              </motion.g>
            </g>
          ))}
          {[
            { x: 448, y: 83 },
            { x: 370, y: 253 },
            { x: 1016, y: 245 },
          ].map(({ x, y }, index) => (
            <motion.path
              animate={
                reduced
                  ? undefined
                  : { opacity: [0.55, 0.95, 0.55], y: [0, -6, 0] }
              }
              d={`M${x - 10} ${y}h20M${x} ${y - 10}v20`}
              key={x}
              stroke={index === 0 ? "#a7d9ff" : "white"}
              strokeLinecap="round"
              strokeWidth="10"
              transition={loop(5.5 + index, -index)}
            />
          ))}
          {[
            { x: 304, y: 195 },
            { x: 954, y: 83 },
            { x: 1321, y: 122 },
          ].map(({ x, y }) => (
            <circle cx={x} cy={y} fill="#9bcaff" key={x} opacity=".7" r="7" />
          ))}
        </svg>
      </div>

      <div aria-hidden="true" className="medix-footer-character">
        <svg
          className="h-full w-full overflow-visible"
          fill="none"
          viewBox="0 0 600 360"
        >
          <defs>
            <linearGradient
              id={`${uid}-porcelain`}
              x1=".26"
              x2=".8"
              y1=".12"
              y2="1"
            >
              <stop stopColor="#ffffff" />
              <stop offset=".38" stopColor="#f9fafc" />
              <stop offset=".65" stopColor="#e9edf4" />
              <stop offset=".84" stopColor="#eefbff" />
              <stop offset="1" stopColor="#b6e7f8" />
            </linearGradient>
            <radialGradient cx=".33" cy=".18" id={`${uid}-crown`} r=".8">
              <stop stopColor="white" />
              <stop offset=".42" stopColor="white" stopOpacity=".38" />
              <stop offset="1" stopColor="white" stopOpacity="0" />
            </radialGradient>
            <radialGradient cx=".85" cy=".84" id={`${uid}-bounce`} r=".56">
              <stop stopColor="#52dfff" stopOpacity=".48" />
              <stop offset=".62" stopColor="#c7f6ff" stopOpacity=".22" />
              <stop offset="1" stopColor="#b4eafa" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-eye`} x1=".1" x2=".85" y1="0" y2="1">
              <stop stopColor="#020c17" />
              <stop offset=".34" stopColor="#142737" />
              <stop offset=".6" stopColor="#03101e" />
              <stop offset="1" stopColor="#00060c" />
            </linearGradient>
            <radialGradient cx=".35" cy=".1" id={`${uid}-eye-light`} r=".8">
              <stop stopColor="#86abc2" stopOpacity=".65" />
              <stop offset=".45" stopColor="#46657a" stopOpacity=".15" />
              <stop offset="1" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-cross`} x1="0" x2="1" y1="0" y2="1">
              <stop stopColor="#25e7f5" />
              <stop offset=".55" stopColor="#00cbed" />
              <stop offset="1" stopColor="#00a5de" />
            </linearGradient>
            <linearGradient id={`${uid}-ring`} x1="0" x2="1" y1="0" y2=".4">
              <stop stopColor="white" />
              <stop offset=".48" stopColor="#e3ffff" />
              <stop offset="1" stopColor="#70ebfc" />
            </linearGradient>
            <filter
              height="180%"
              id={`${uid}-body-shadow`}
              width="180%"
              x="-40%"
              y="-35%"
            >
              <feDropShadow
                dx="3"
                dy="17"
                floodColor="#15bbef"
                floodOpacity=".23"
                stdDeviation="16"
              />
            </filter>
            <filter
              height="240%"
              id={`${uid}-glow`}
              width="240%"
              x="-70%"
              y="-70%"
            >
              <feGaussianBlur result="blur" stdDeviation="5" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <clipPath id={`${uid}-body-clip`}>
              <path d={body} />
            </clipPath>
          </defs>
          <motion.g
            animate={orbitMotion}
            style={{ transformOrigin: "300px 250px" }}
            transition={loop(10.8)}
          >
            <path d={orbitBack} opacity=".7" stroke="#81f0fb" strokeWidth="4" />
          </motion.g>
          <motion.g
            animate={
              reduced
                ? undefined
                : {
                    rotate: [0, -0.8, 0.6, 0],
                    scaleX: [1, 1.018, 0.995, 1],
                    scaleY: [1, 0.982, 1.012, 1],
                  }
            }
            style={{ transformOrigin: "300px 338px" }}
            transition={loop(7.4)}
          >
            <path
              d={body}
              fill={url("porcelain")}
              filter={url("body-shadow")}
            />
            <g clipPath={url("body-clip")}>
              <path d={body} fill={url("crown")} />
              <path d={body} fill={url("bounce")} />
              <path
                d="M132 270C169 214 175 143 205 97C231 56 261 42 302 41"
                stroke="white"
                strokeOpacity=".7"
                strokeWidth="3"
              />
              <path
                d="M417 216C428 272 466 305 491 323"
                stroke="#aeebfa"
                strokeOpacity=".45"
                strokeWidth="5"
              />
            </g>
            <motion.g
              animate={
                reduced
                  ? undefined
                  : { x: [0, 0, -7, -7, 3, 3, 0], y: [0, 0, 2, 2, -3, -3, 0] }
              }
              transition={{
                ...loop(14.7),
                times: [0, 0.16, 0.24, 0.42, 0.53, 0.73, 1],
              }}
            >
              {[
                { angle: 12, x: 243, y: 154 },
                { angle: 9, x: 314, y: 164 },
              ].map(({ x, y, angle }, index) => (
                <g key={x} transform={`translate(${x} ${y}) rotate(${angle})`}>
                  <motion.g
                    animate={
                      reduced
                        ? undefined
                        : { scaleY: [1, 1, 0.06, 1, 1, 0.08, 1, 0.12, 1, 1] }
                    }
                    style={{ transformOrigin: "0px 0px" }}
                    transition={{
                      ...loop(4.5, index * 0.045),
                      times: [
                        0, 0.28, 0.295, 0.317, 0.72, 0.735, 0.755, 0.78, 0.802,
                        1,
                      ],
                    }}
                  >
                    <ellipse
                      fill={url("eye")}
                      rx="18"
                      ry="32"
                      stroke="#00101c"
                      strokeWidth="1.5"
                    />
                    <ellipse
                      cx="-2"
                      cy="-5"
                      fill={url("eye-light")}
                      rx="14"
                      ry="26"
                    />
                    <path
                      d="M-9-22C-5-27 1-28 5-25"
                      stroke="#bed6e4"
                      strokeLinecap="round"
                      strokeOpacity=".38"
                      strokeWidth="2"
                    />
                  </motion.g>
                </g>
              ))}
            </motion.g>
            <path
              d="M371 227C365 227 360 232 360 239V249H349C342 249 337 254 337 261C337 268 342 272 349 272H360V284C360 291 365 296 371 296C378 296 383 291 383 284V272H394C401 272 406 268 406 261C406 254 401 249 394 249H383V239C383 232 378 227 371 227Z"
              fill={url("cross")}
              filter={url("glow")}
              stroke="#d1ffff"
              strokeWidth="1.8"
            />
          </motion.g>
          <motion.g
            animate={orbitMotion}
            style={{ transformOrigin: "300px 250px" }}
            transition={loop(10.8)}
          >
            <path
              d={orbitFront}
              filter={url("glow")}
              opacity=".3"
              stroke="#a3f3ff"
              strokeWidth="8"
            />
            <path
              d={orbitFront}
              stroke={url("ring")}
              strokeLinecap="round"
              strokeWidth="4.5"
            />
            <motion.path
              animate={reduced ? undefined : { strokeDashoffset: [0, -784] }}
              d={orbitFront}
              stroke="white"
              strokeDasharray="24 760"
              strokeLinecap="round"
              strokeWidth="5"
              transition={{
                duration: 7,
                ease: "linear",
                repeat: Number.POSITIVE_INFINITY,
              }}
            />
          </motion.g>
          <motion.g
            animate={
              reduced ? undefined : { opacity: [0.5, 1, 0.5], y: [0, -3, 0] }
            }
            stroke="#00c5f0"
            strokeLinecap="round"
            strokeWidth="10"
            transition={loop(4.6)}
          >
            <path
              d="M446 50l13-22M467 70l23-10"
              stroke="white"
              strokeWidth="14"
            />
            <path d="M446 50l13-22M467 70l23-10" />
          </motion.g>
        </svg>
      </div>

      <svg
        aria-hidden="true"
        className="medix-footer-hands"
        fill="none"
        viewBox="0 0 600 360"
      >
        <defs>
          <radialGradient cx=".36" cy=".17" id={`${uid}-hand`} r=".95">
            <stop stopColor="white" />
            <stop offset=".44" stopColor="#f7faff" />
            <stop offset=".78" stopColor="#e3edf9" />
            <stop offset="1" stopColor="#b9e7fb" />
          </radialGradient>
          <filter
            height="260%"
            id={`${uid}-hand-shadow`}
            width="220%"
            x="-60%"
            y="-70%"
          >
            <feDropShadow
              dx="0"
              dy="9"
              floodColor="#72bbed"
              floodOpacity=".26"
              stdDeviation="7"
            />
          </filter>
        </defs>
        {[
          { angle: -6, x: 150 },
          { angle: 5, x: 450 },
        ].map(({ x, angle }, index) => (
          <g key={x} transform={`translate(${x} 325) rotate(${angle})`}>
            <motion.g
              animate={
                reduced
                  ? undefined
                  : {
                      rotate: [0, index ? -2 : 2, 0],
                      scaleY: [1, 1.035, 1],
                      y: [0, -2, 0],
                    }
              }
              style={{ transformOrigin: "0px 12px" }}
              transition={loop(7.4, index * 0.7)}
            >
              <path
                d="M-48 9C-51-12-28-34-3-34C23-35 47-16 49 6C52 23 31 29 2 28C-22 29-45 26-48 9Z"
                fill={url("hand")}
                filter={url("hand-shadow")}
              />
              <path
                d="M-39-9C-31-24-12-31 5-29"
                stroke="white"
                strokeLinecap="round"
                strokeOpacity=".9"
                strokeWidth="2"
              />
            </motion.g>
          </g>
        ))}
      </svg>
    </>
  );
}
