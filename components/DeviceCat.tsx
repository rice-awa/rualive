import styles from '@/styles/device-cat.module.css'

/** 设备三态（与 util/deviceFormat 的 DeviceState 一致） */
export type CatState = 'online' | 'idle' | 'offline'

/**
 * 圆团猫猫，移植自 docs/cat-animation-prototype-v2.html。
 * 在线坐姿眨眼摇尾、挂机趴睡呼吸、离线天使漂浮；各部件独立运动。
 * 尺寸适配父容器，描边随图形缩放，兼顾卡片和详情的小尺寸显示。
 */
export default function DeviceCat({ state }: { state: CatState }) {
  return (
    <svg
      className={`${styles.cat} ${styles[state]}`}
      viewBox="0 0 300 270"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {state === 'online' && (
        <>
          <ellipse className={styles.shadow} cx="150" cy="237" rx="69" ry="9" />
          <g className={styles.body}>
            <g className={styles.tail}>
              <path
                className={[styles.ink, styles.fur].join(' ')}
                d="M191 209C229 219 259 197 251 168C247 153 231 157 235 172C240 192 220 196 197 192Z"
              />
              <path
                d="M240 163Q248 160 246 176"
                fill="none"
                stroke="#d6e7b3"
                strokeWidth="7"
                strokeLinecap="round"
              />
            </g>
            <path
              className={[styles.ink, styles.fur].join(' ')}
              d="M119 139Q150 128 181 139C194 151 208 177 211 204Q215 230 192 233H108Q85 230 89 204C92 177 106 151 119 139Z"
            />
            <path
              className={styles.cream}
              d="M131 168C114 177 114 211 130 221Q150 230 170 221C186 211 186 177 169 168Q150 160 131 168Z"
            />
            <path
              className={[styles.ink, styles.fur].join(' ')}
              d="M109 214C90 211 88 232 106 235H128Q137 232 133 221M167 221Q163 232 172 235H194C212 232 210 211 191 214"
            />
            <path className={styles.line} d="M111 224v6m10-6v7m59-7v7m10-7v6" strokeWidth="2" />
            <path
              className={styles.line}
              d="M120 179Q114 194 119 205Q125 212 131 206L133 190M180 179Q186 194 181 205Q175 212 169 206L167 190"
            />
            <g transform="translate(36 24.36) scale(.76)">
              <g className={styles.head}>
                <path
                  className={[styles.ink, styles.fur, styles['ear-tip']].join(' ')}
                  d="M91 97Q85 81 90 63Q92 57 99 63L124 81Z"
                />
                <path className={styles.pink} d="M98 70L113 82L98 88Z" />
                <path
                  className={[styles.ink, styles.fur].join(' ')}
                  d="M176 81L201 63Q208 57 210 64Q215 81 209 98Z"
                />
                <path className={styles.pink} d="M202 71L187 83L202 89Z" />
                <path
                  className={[styles.ink, styles.fur].join(' ')}
                  d="M104 85Q150 69 196 85C218 95 227 116 221 139C215 168 183 180 150 180S85 168 79 139C73 116 82 95 104 85Z"
                />
                <path
                  d="M137 77l4 12m9-13v10m10-9-3 12"
                  fill="none"
                  stroke="#8caf62"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                <path
                  className={styles.cream}
                  d="M117 146Q127 134 150 140Q173 134 183 146C190 166 169 176 150 176S110 166 117 146Z"
                />
                <g className={styles.eyes} fill="#4a3b2c">
                  <ellipse cx="125" cy="124" rx="5.4" ry="7" />
                  <ellipse cx="175" cy="124" rx="5.4" ry="7" />
                  <g fill="#fffaf0">
                    <circle cx="126.5" cy="122" r="2" />
                    <circle cx="176.5" cy="122" r="2" />
                  </g>
                </g>
                <ellipse className={styles.pink} cx="105" cy="142" rx="10" ry="5" opacity=".7" />
                <ellipse className={styles.pink} cx="195" cy="142" rx="10" ry="5" opacity=".7" />
                <path d="M145 141Q150 138 155 141L150 146Z" fill="#9c7263" />
                <path
                  className={styles.line}
                  d="M150 146v5m-11-1q3 9 11 1q8 8 11-1M88 133l-16-3m17 12-14 3m137-12 16-3m-17 12 14 3"
                  strokeWidth="2.5"
                />
              </g>
            </g>
          </g>
        </>
      )}
      {state === 'idle' && (
        <>
          <ellipse className={styles.shadow} cx="150" cy="237" rx="85" ry="9" />
          <g className={styles.sleeper}>
            <path
              className={[styles.ink, styles.fur].join(' ')}
              d="M88 213C79 184 110 141 164 143C216 143 244 174 242 209Q239 233 201 233H112Z"
            />
            <path className={styles.cream} d="M162 211Q193 188 221 209Q224 223 202 226H164Z" />
            <g className={styles['tail-tip']}>
              <path
                className={[styles.ink, styles.fur].join(' ')}
                d="M211 202C189 190 164 204 160 219C156 232 179 239 211 229C225 225 233 216 225 210Q219 205 211 210Q189 222 179 218"
              />
            </g>
            <g transform="translate(24.64 48.4) scale(.78)">
              <path
                className={[styles.ink, styles.fur].join(' ')}
                d="M68 162L68 126Q68 119 75 123L103 143M129 143L155 123Q162 119 162 128L159 167"
              />
              <path className={styles.pink} d="M77 134l15 12-14 10Zm76 0-15 12 14 10Z" />
              <path
                className={[styles.ink, styles.fur].join(' ')}
                d="M85 146Q113 134 144 147C164 153 177 173 171 193L175 200L165 203C155 220 134 226 112 226C85 226 64 216 59 200L51 195L58 189C56 168 67 153 85 146Z"
              />
              <path
                d="M105 143l3 10m8-10v8m9-7-3 10"
                fill="none"
                stroke="#b1a896"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                className={styles.cream}
                d="M86 199Q113 184 140 199Q143 215 112 218Q83 216 86 199Z"
              />
              <path className={styles.line} d="M77 182q9 9 18 0m33 0q9 9 18 0" />
              <path d="M108 196q5-3 10 0l-5 5Z" fill="#9c7263" />
              <path
                className={styles.line}
                d="M113 201v3m-8 0q3 6 8 0q5 6 8 0M68 194l-14-2m16 10-13 3m101-11 14-2"
                strokeWidth="2.5"
              />
              <ellipse className={styles.pink} cx="77" cy="198" rx="8" ry="4" opacity=".5" />
              <ellipse className={styles.pink} cx="150" cy="198" rx="8" ry="4" opacity=".5" />
            </g>
            <path
              className={[styles.ink, styles.fur].join(' ')}
              d="M91 221Q75 216 77 228Q79 236 98 233H112Q116 223 106 221M125 222Q121 233 134 234H145Q157 232 151 223Q145 216 135 222"
            />
          </g>
          <text className={styles.zzz} x="179" y="115">
            z
          </text>
          <text className={[styles.zzz, styles.second].join(' ')} x="204" y="91">
            z
          </text>
        </>
      )}
      {state === 'offline' && (
        <>
          <ellipse className={styles.shadow} cx="150" cy="237" rx="53" ry="8" />
          <g className={styles.spirit}>
            <g className={styles['wing-left']}>
              <path
                className={[styles.ink, styles.cream].join(' ')}
                d="M113 174C99 149 80 141 61 142Q53 144 64 157Q43 151 49 164Q54 175 66 181Q54 181 62 190Q82 207 111 192Z"
              />
              <path className={styles.line} d="M68 163l23 16m-21 4 18 3" strokeWidth="2" />
            </g>
            <g className={styles['wing-right']}>
              <path
                className={[styles.ink, styles.cream].join(' ')}
                d="M187 174C201 149 220 141 239 142Q247 144 236 157Q257 151 251 164Q246 175 234 181Q246 181 238 190Q218 207 189 192Z"
              />
              <path className={styles.line} d="M232 163l-23 16m21 4-18 3" strokeWidth="2" />
            </g>
            <path
              className={[styles.ink, styles.fur].join(' ')}
              d="M118 137Q150 127 182 137C197 157 206 190 201 207Q195 225 179 214Q167 231 150 218Q133 231 121 214Q105 225 99 207C94 190 103 157 118 137Z"
            />
            <ellipse className={styles.cream} cx="150" cy="186" rx="29" ry="25" />
            <path
              className={styles.line}
              d="M118 173q-3 17 10 17q7-1 8-10M182 173q3 17-10 17q-7-1-8-10"
            />
            <g transform="translate(36 24) scale(.76)">
              <path
                className={[styles.ink, styles.fur].join(' ')}
                d="M92 97L91 67Q91 59 98 64L123 82M177 82L202 64Q209 59 209 67L208 97"
              />
              <path className={styles.pink} d="M99 75l15 12-14 8Zm102 0-15 12 14 8Z" />
              <path
                className={[styles.ink, styles.fur].join(' ')}
                d="M107 83Q150 70 193 83C214 91 224 114 219 134L224 142L215 146C204 168 177 177 150 177S96 168 85 146L76 142L81 134C76 114 86 91 107 83Z"
              />
              <path
                d="M139 80l3 10m9-12v9m10-7-3 10"
                fill="none"
                stroke="#9e9181"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                className={styles.cream}
                d="M123 144Q135 136 150 141Q165 136 177 144C185 160 166 169 150 169S115 160 123 144Z"
              />
              <path className={styles.line} d="M120 120l10 10m0-10-10 10m50-10 10 10m0-10-10 10" />
              <path d="M145 141q5-3 10 0l-5 5Z" fill="#9c7263" />
              <path
                className={styles.line}
                d="M150 146v4m-9 0q3 7 9 0q6 7 9 0M93 136l-15-2m16 10-13 3m126-11 15-2m-16 10 13 3"
                strokeWidth="2.5"
              />
            </g>
            <ellipse
              className={styles.halo}
              cx="150"
              cy="52"
              rx="23"
              ry="6"
              fill="none"
              stroke="#d5b45e"
              strokeWidth="4"
            />
          </g>
        </>
      )}
    </svg>
  )
}
