// Check if we're in a Node.js environment
if (typeof module !== "undefined" && module.exports) {
  var Handlebars = require("handlebars");
} else if (typeof window !== "undefined") {
}

export const TOOLTIPS = {
  featured: `
      <div class="filter-tooltip" id="featuredTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Featured?</strong> Featured mice are those highlighted for their standout qualities, such as innovative technology, exceptional performance, or unique design elements.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> These mice often represent the best in their category, offering cutting-edge features or superior user experiences, making them ideal for gamers seeking top-tier options.
          </div>
        </div>
      </div>
    `,
  rating: `
      <div class="filter-tooltip" id="ratingTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>How do these scores work?</strong> All EG mouse scores use a 0–10 scale benchmarked against today’s leading mice as of each product’s “Last updated” date. The bars here show the core scores we use across our mouse reviews and hubs.
          </div>
          <div class="tooltip-item">
            <strong>Overall:</strong> Snapshot of performance plus value at today’s typical price, balancing accuracy, response, feet, comfort, build quality and genre suitability versus similar mice.
          </div>
          <div class="tooltip-item">
            <strong>Accuracy:</strong> Tracking precision relative to modern gaming sensors, based on our sensor reference table, implementation quality, launch year and how stable the cursor feels in real play.
          </div>
          <div class="tooltip-item">
            <strong>Response:</strong> Click and motion snappiness from switch hardware, measured click latency, polling stability and the age of the underlying design.
          </div>
          <div class="tooltip-item">
            <strong>Quality:</strong> Build and long-term reliability: shell flex and creaks, switch consistency, scroll feel, wireless stability and QC trends across many owner and reviewer reports.
          </div>
          <div class="tooltip-item">
            <strong>Comfort:</strong> Long-session ergonomics for common grip styles and hand sizes, based on shape, weight balance, coatings and user/reviewer feedback.
          </div>
          <div class="tooltip-item">
            <strong>Work:</strong> Day-to-day usability for work, including comfort, button layout, scroll behaviour and how flexible the software and macro options are.
          </div>
          <div class="tooltip-item">
            <strong>Feet:</strong> Glide quality of the stock feet: material, smoothness, edge finish, control versus speed and how they wear in over time.
          </div>
        </div>
      </div>
    `,

  overall: `
      <div class="filter-tooltip" id="overallTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Overall Rating?</strong> The overall score is a 0–10 snapshot of performance plus value at today’s typical price, balancing accuracy, response, feet, comfort, build quality and genre suitability versus similar mice.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> It rolls all the detailed scores and current pricing into a single number, so you can quickly see whether a mouse is a strong all-around pick in today’s market.
          </div>
        </div>
      </div>
    `,

  overall: `
      <div class="filter-tooltip" id="overallTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Overall Rating?</strong> The overall rating combines key performance metrics like accuracy, response, quality, and comfort to reflect the mouse's general effectiveness for gaming.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> This rating provides a quick snapshot of a mouse’s all-around performance, helping gamers identify well-balanced options suitable for various playstyles.
          </div>
        </div>
      </div>
    `,
  comfort: `
      <div class="filter-tooltip" id="comfortTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Comfort?</strong> Comfort evaluates the ergonomics, weight balance, and design of a mouse to ensure it feels natural and reduces fatigue during long gaming sessions.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> A comfortable mouse enhances gameplay by supporting extended use, improving control, and preventing strain, especially for competitive or marathon gaming.
          </div>
        </div>
      </div>
    `,
  accuracy: `
      <div class="filter-tooltip" id="accuracyTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Accuracy?</strong> Accuracy measures how precisely a mouse’s sensor tracks movement, ensuring cursor movement aligns with physical input.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> High accuracy is critical for gaming, particularly in genres like FPS, where pinpoint precision is essential for targeting and control.
          </div>
        </div>
      </div>
    `,
  quality: `
      <div class="filter-tooltip" id="qualityTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Quality?</strong> Quality assesses the mouse’s build materials, durability, and sensor technology, reflecting its reliability and longevity.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> A high-quality mouse ensures consistent performance, withstands heavy use, and maintains functionality over time, offering long-term value.
          </div>
        </div>
      </div>
    `,
  response: `
      <div class="filter-tooltip" id="responseTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Response?</strong> Response evaluates the speed, input lag, and click latency of a mouse, measuring how quickly it registers actions.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> Fast response times are crucial for competitive gaming, ensuring actions like clicks and movements are executed instantly for optimal performance.
          </div>
        </div>
      </div>
    `,
  work: `
  <div class="filter-tooltip" id="workTooltip">
    <div class="tooltip-text">
      <div class="tooltip-item">
        <strong>What is Work Rating?</strong> The work rating evaluates a mouse’s suitability for productivity tasks, considering factors like comfort during extended use, programmable buttons for efficiency, and compatibility with various software environments.
      </div>
      <div class="tooltip-item">
        <strong>Why Does It Matter?</strong> For users who need a mouse that excels in both gaming and work, a high work rating ensures the device supports long hours of use, enhances productivity with customizable features, and integrates seamlessly with professional tools.
      </div>
    </div>
  </div>
`,
  genre: `
      <div class="filter-tooltip" id="genreTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Genre?</strong> Genre indicates the game types (e.g., FPS, MOBA, RTS) a mouse is optimized for based on its features and performance.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> Matching a mouse to your preferred game genre ensures it supports the specific demands, such as precision for FPS or programmable buttons for MMOs.
          </div>
        </div>
      </div>
    `,
  fps_score: `
      <div class="filter-tooltip" id="fpsScoreTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is FPS Score?</strong> The FPS score evaluates a mouse’s performance for First-Person Shooter games, focusing on accuracy, response, and low latency.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> A high FPS score indicates a mouse optimized for precise aiming and fast reactions, critical for competitive FPS gaming.
          </div>
        </div>
      </div>
    `,
  mmo_score: `
      <div class="filter-tooltip" id="mmoScoreTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is MMO Score?</strong> The MMO score assesses a mouse’s suitability for Massively Multiplayer Online games, emphasizing programmable buttons and comfort.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> A high MMO score ensures a mouse supports complex inputs and extended play, ideal for managing multiple skills and macros in MMOs.
          </div>
        </div>
      </div>
    `,
  moba_score: `
      <div class="filter-tooltip" id="mobaScoreTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is MOBA Score?</strong> The MOBA score rates a mouse’s performance for Multiplayer Online Battle Arena games, prioritizing precision and programmable buttons.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> A high MOBA score reflects a mouse’s ability to handle quick, accurate clicks and key bindings, essential for fast-paced MOBA gameplay.
          </div>
        </div>
      </div>
    `,
  aarpg_score: `
      <div class="filter-tooltip" id="aarpgScoreTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is AARPG Score?</strong> The AARPG score evaluates a mouse’s effectiveness for Action Adventure Role-Playing Games, focusing on comfort and versatile controls.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> A high AARPG score indicates a mouse suited for long sessions and varied inputs, enhancing gameplay in story-driven or action-heavy RPGs.
          </div>
        </div>
      </div>
    `,
  rts_score: `
      <div class="filter-tooltip" id="rtsScoreTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is RTS Score?</strong> The RTS score measures a mouse’s performance for Real-Time Strategy games, emphasizing accuracy and programmable buttons for unit control.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> A high RTS score ensures a mouse supports precise cursor control and quick command execution, vital for managing complex RTS gameplay.
          </div>
        </div>
      </div>
    `,
  release_date: `
      <div class="filter-tooltip" id="releaseDateTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Release Date?</strong> The release date, shown as month and year (MM/YYYY), indicates when a mouse was first available on the market.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> Filtering by release date helps identify newer models with advanced technology or older, potentially cost-effective options.
          </div>
        </div>
      </div>
    `,
  design: `
      <div class="filter-tooltip" id="designTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Design?</strong> Design refers to the visual aesthetics of a mouse, including solid colors, multi-color patterns, themed editions, or rare limited editions.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> A mouse’s design allows for personalization and style, appealing to gamers who value aesthetics alongside performance.
          </div>
        </div>
      </div>
    `,
  lighting: `
      <div class="filter-tooltip" id="lightingTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Lighting?</strong> Lighting refers to the type of illumination on a mouse, such as RGB or single-color LEDs, and its customization options.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> Customizable lighting enhances aesthetics and can sync with game events or setups, adding immersion and personal flair.
          </div>
        </div>
      </div>
    `,
  connectivity: `
      <div class="filter-tooltip" id="connectivityTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Connectivity?</strong> Connectivity describes how a mouse connects to a device, such as via 2.4GHz dongle, Bluetooth, USB-A, or USB-C.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> The connection type affects latency, portability, and compatibility, with wireless options offering freedom and wired providing reliability.
          </div>
        </div>
      </div>
    `,
  paracord: `
      <div class="filter-tooltip" id="paracordTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is a Paracord Cable?</strong> A paracord cable is a lightweight, flexible cable designed to minimize drag and resistance during mouse movement.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> Paracord cables enhance maneuverability, enabling smoother and faster movements, which is critical for precision in competitive gaming.
          </div>
        </div>
      </div>
    `,
  battery_hours: `
      <div class="filter-tooltip" id="batteryHoursTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Battery Hours?</strong> Battery hours indicate how long a wireless mouse can operate on a single charge, measured in hours.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> Longer battery life ensures uninterrupted gaming, reducing the need for frequent recharging, ideal for extended sessions.
          </div>
        </div>
      </div>
    `,
  hand_size: `
      <div class="filter-tooltip" id="handSizeTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Hand Size?</strong> Hand size refers to the mouse dimensions designed to fit specific hand measurements, accommodating various grip styles.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> A mouse matched to hand size improves comfort and control, reducing strain and enhancing precision during gameplay.
          </div>
        </div>
      </div>
    `,
  grip: `
      <div class="filter-tooltip" id="gripTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>Claw Grip:</strong> The user holds the mouse with a bent finger position, using fingertips and the base of the palm.
          </div>
          <div class="tooltip-item">
            <strong>Palm Grip:</strong> The user rests their entire hand on the mouse, with fingers fully extended.
          </div>
          <div class="tooltip-item">
            <strong>Fingertip Grip:</strong> The user only touches the mouse with their fingertips, keeping the palm raised.
          </div>
        </div>
      </div>
    `,
  form_factor: `
      <div class="filter-tooltip" id="formFactorTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Form Factor?</strong> Form factor refers to the design or shape of a gaming mouse, which dictates how it fits and feels in your hand. This includes considerations for right-handed, left-handed, or ambidextrous use.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> The form factor impacts ergonomics, comfort, and control. A well-designed form factor can reduce strain, improve grip, and enhance your gaming experience by allowing for natural hand movements and positioning.
          </div>
          <div class="tooltip-item">
            <strong>Common Form Factors:</strong>
            <div class="tooltip-list">
              <div class="tooltip-list-item"><strong>Right-Handed:</strong> Ergonomically shaped for the right hand, with side buttons often on the left for thumb access.</div>
              <div class="tooltip-list-item"><strong>Left-Handed:</strong> A mirror image of right-handed mice, tailored for left-handed users with side buttons on the right.</div>
              <div class="tooltip-list-item"><strong>Ambidextrous:</strong> Symmetrical design, offering universal use with side buttons either on both sides or not included to maintain symmetry.</div>
            </div>
          </div>
        </div>
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>Choosing the Right Form Factor:</strong> Your choice should align with your dominant hand, grip style, and whether you need or prefer side buttons. Right or left-handed mice offer better ergonomic support for specific hands, while ambidextrous mice provide versatility at the cost of some ergonomic specialization.
          </div>
        </div>
      </div>
    `,
  shape: `
      <div class="filter-tooltip" id="shapeTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Shape?</strong> Shape refers to the overall structure of a gaming mouse, which can significantly affect how it feels in your hand, influencing grip, comfort, and control during use.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> The shape of a mouse impacts ergonomic fit, which can reduce hand fatigue, improve precision, and enhance the overall gaming experience by allowing for a natural hand position.
          </div>
          <div class="tooltip-item">
            <strong>Common Mouse Shapes:</strong>
            <div class="tooltip-list">
              <div class="tooltip-list-item"><strong>Symmetrical:</strong> Designed to be equally comfortable for both left and right-handed users. These mice lack pronounced curves, offering a universal fit but might sacrifice some ergonomic benefits for specialized hand use.</div>
              <div class="tooltip-list-item"><strong>Ergonomic:</strong> Tailored to fit the natural curve of the hand, typically for right-handed users. This shape provides better support and comfort, reducing strain over long periods, but might not suit left-handed users as well without specific design.</div>
              <div class="tooltip-list-item"><strong>Asymmetrical:</strong> Often a variation of ergonomic design, where the mouse might have unique features or shapes not mirrored on both sides, enhancing grip or adding functionality like extra buttons for specific fingers. This can be highly specialized for gaming performance but less versatile for different hand orientations.</div>
            </div>
          </div>
        </div>
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>Choosing the Right Shape:</strong> Select a shape based on your dominant hand, grip style (palm, claw, or fingertip), and whether you prioritize comfort, precision, or versatility. Symmetrical shapes offer flexibility, ergonomic shapes provide comfort for the intended hand, and asymmetrical shapes can offer unique advantages for specific gaming needs.
          </div>
        </div>
      </div>
    `,
  hump: `
      <div class="filter-tooltip" id="humpTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is the Hump?</strong> The hump is the highest point of a gaming mouse's body, typically located towards the back, middle, or front. This design feature significantly influences hand positioning and overall comfort during use.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> The position of the hump affects how the mouse fits in your hand, impacting grip style (palm, claw, or fingertip), control, and fatigue over long gaming sessions. A well-placed hump can enhance gaming performance by providing ergonomic support where needed.
          </div>
          <div class="tooltip-item">
            <strong>Common Hump Positions:</strong>
            <div class="tooltip-list">
              <div class="tooltip-list-item"><strong>Front:</strong> The hump is positioned towards the front, which can provide a different grip dynamic, potentially beneficial for users with specific grip preferences or smaller hands, focusing on finger control with less palm support.</div>
              <div class="tooltip-list-item"><strong>Middle:</strong> Offers versatility, suitable for various grip styles, providing balanced support.</div>
              <div class="tooltip-list-item"><strong>Back - Front:</strong> Supports the entire hand, ideal for larger hands or palm grip, might not suit claw or fingertip grip as well.</div>
              <div class="tooltip-list-item"><strong>Back Mid:</strong> Good for claw grip, offering lift under the palm while keeping the front low for finger control.</div>
              <div class="tooltip-list-item"><strong>Back - Rear:</strong> Less common, beneficial for fingertip grip or smaller hands, prioritizing finger dexterity over palm support.</div>
            </div>
          </div>
        </div>
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>Choosing the Right Hump:</strong> Selecting a mouse with the right hump position depends on your hand size, preferred grip style, and gaming needs. Each position offers different advantages, from comfort to precision, making it crucial for gamers to choose based on their ergonomic preferences.
          </div>
        </div>
      </div>
    `,
  front_flare: `
      <div class="filter-tooltip" id="frontFlareTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Front Flare?</strong> Front flare describes the curvature or shape at the front of the mouse, specifically where your index and middle fingers rest on the right and left click buttons respectively.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> The design of the front flare directly impacts how your fingers interact with the primary click buttons, affecting comfort, ease of clicking, and the precision of your mouse control during gaming.
          </div>
          <div class="tooltip-item">
            <strong>Types of Front Flare:</strong>
            <div class="tooltip-list">
              <div class="tooltip-list-item"><strong>Flat:</strong> Here, the front edge where the click buttons are located is flat. This provides a straightforward, even surface for your fingers to press directly down on, which might be preferred for those who like a simple, direct interaction with the buttons, offering less guidance but more control over click precision.</div>
              <div class="tooltip-list-item"><strong>Inward:</strong> The front curves inward, wrapping slightly around your fingers. This can enhance the feeling of control, especially for fingertip grip users, as it allows your index and middle fingers to curl around the mouse, potentially reducing the distance your fingers need to travel to click, thus improving response time.</div>
              <div class="tooltip-list-item"><strong>Outward:</strong> With a more pronounced outward flare, this design gives additional room for finger movement, particularly useful for gamers with larger hands or those who need extra space for finger action. It can make the right and left click buttons feel more accessible, promoting a relaxed finger posture which might be less tiring over long sessions.</div>
            </div>
          </div>
        </div>
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>Choosing the Right Front Flare:</strong> The choice depends on how you prefer your fingers to interact with the click buttons. A <strong>front flare</strong> might provide comfort and security, <strong>flat</strong> offers simplicity and direct control, <strong>inward</strong> can enhance precision and speed for quick clicks, and <strong>outward</strong> might be ideal for comfort and ease with larger hands or more dynamic finger movements. Each type influences how naturally your fingers rest on and operate the primary click buttons, impacting your overall gaming performance and comfort.
          </div>
        </div>
      </div>
    `,
  mcu: `
      <div class="filter-tooltip" id="mcuTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is an MCU?</strong> The MCU, or Microcontroller Unit, is the miniature processor inside a gaming mouse that controls inputs, manages settings, and ensures smooth communication with your computer.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> Higher-end MCUs offer better performance, lower latency, and improved wireless stability, making them essential for competitive gaming.
          </div>
          <div class="tooltip-item">
            <strong>Common MCU Features:</strong>
            <div class="tooltip-list">
              <div class="tooltip-list-item"><strong>Onboard memory:</strong> for storing profiles & DPI settings</div>
              <div class="tooltip-list-item"><strong>Enhanced power efficiency:</strong> for wireless mice</div>
              <div class="tooltip-list-item"><strong>Faster processing:</strong> for low-latency inputs</div>
            </div>
          </div>
        </div>
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>Choosing the Right MCU:</strong> Some brands use custom MCUs, while others rely on trusted manufacturers like Nordic, STMicroelectronics, or PixArt. More advanced MCUs generally lead to a smoother and more responsive gaming experience.
          </div>
        </div>
      </div>
    `,
  sensor: `
      <div class="filter-tooltip" id="sensorTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is a Sensor?</strong> A sensor in a gaming mouse is the component responsible for detecting movement and translating it into cursor movement on your screen. Different sensors like PMW, PAW, Hero, and others vary in technology and performance metrics.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> The type of sensor directly affects the tracking accuracy, speed, responsiveness, and sometimes power efficiency of a mouse. High-quality sensors can provide a competitive edge by ensuring precise cursor control, which is crucial in gaming for accuracy in aiming or quick movements.
          </div>
          <div class="tooltip-item">
            <strong>Common Sensors:</strong>
            <div class="tooltip-list">
              <div class="tooltip-list-item"><strong>PMW (PixArt Maximum Performance Wireless):</strong> Known for high performance in wired setups, offering excellent tracking precision and speed.</div>
              <div class="tooltip-list-item"><strong>PAW (PixArt Adaptive Wireless):</strong> Focused on power efficiency, ideal for wireless mice, with good tracking capabilities and speed.</div>
              <div class="tooltip-list-item"><strong>Hero (Logitech):</strong> Renowned for its power efficiency and high accuracy, suitable for both wired and wireless applications.</div>
              <div class="tooltip-list-item"><strong>TrueMove Pro (SteelSeries):</strong> Provides advanced stabilization for precise tracking on various surfaces.</div>
              <div class="tooltip-list-item"><strong>Focus Pro (Razer):</strong> Designed for professional gaming with top-tier performance metrics.</div>
              <div class="tooltip-list-item"><strong>Owl-Eye (ROCCAT):</strong> Custom sensor with features tailored for gaming precision.</div>
            </div>
          </div>
        </div>
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>Choosing the Right Sensor:</strong> When selecting a mouse, consider the sensor based on your gaming needs. If you're into competitive gaming, look for sensors with high DPI, IPS, and low latency like PMW or Focus Pro. For longevity in wireless setups, sensors like PAW or Hero are preferable due to their power efficiency. Also, consider your preference for wired vs. wireless, as some sensors are optimized for specific use cases.
          </div>
        </div>
      </div>
    `,
  flawless_sensor: `
    <div class="filter-tooltip" id="flawlessSensorTooltip">
      <div class="tooltip-text">
        <div class="tooltip-item">
          <strong>What is a Flawless Sensor?</strong> A flawless sensor performs without significant issues like smoothing, jitter, or angle snapping, ensuring precise and reliable tracking.
        </div>
        <div class="tooltip-item">
          <strong>Why Does It Matter?</strong> Flawless sensors deliver consistent cursor control, critical for competitive gaming where even minor tracking errors can impact performance.
        </div>
      </div>
    </div>
  `,
  sensor_latency: `
    <div class="filter-tooltip" id="sensorLatencyTooltip">
      <div class="tooltip-text">
        <div class="tooltip-item">
          <strong>What is Sensor Latency?</strong> Sensor latency is the time it takes for a mouse to register and transmit movement or input, measured in milliseconds (ms).
        </div>
        <div class="tooltip-item">
          <strong>Why Does It Matter?</strong> Lower sensor latency ensures faster response times, crucial for competitive gaming where split-second actions can determine outcomes.
        </div>
      </div>
    </div>
  `,
  sensor_latency_list: `
    <div class="filter-tooltip" id="sensorLatencyListTooltip">
      <div class="tooltip-text">
        <div class="tooltip-item">
          <strong>What is Sensor Latency?</strong> Sensor latency is the time it takes for a mouse to register and transmit movement or input, measured in milliseconds (ms).
        </div>
        <div class="tooltip-item">
          <strong>Why Does It Matter?</strong> Lower sensor latency ensures faster response times, crucial for competitive gaming where split-second actions can determine outcomes.
        </div>
      </div>
    </div>
  `,
  dpi: `
    <div class="filter-tooltip" id="dpiTooltip">
      <div class="tooltip-text">
        <div class="tooltip-item">
          <strong>What is DPI?</strong> Dots Per Inch (DPI) measures the sensitivity of a mouse, determining how far the cursor moves per inch of physical movement.
        </div>
        <div class="tooltip-item">
          <strong>Why Does It Matter?</strong> Higher DPI allows faster cursor movement, ideal for high-resolution displays or fast-paced gaming, while lower DPI offers precision for detailed tasks.
        </div>
      </div>
    </div>
  `,
  ips: `
    <div class="filter-tooltip" id="ipsTooltip">
      <div class="tooltip-text">
        <div class="tooltip-item">
          <strong>What is IPS?</strong> Inches Per Second (IPS) indicates the maximum speed at which a mouse sensor can move while still accurately tracking.
        </div>
        <div class="tooltip-item">
          <strong>Why Does It Matter?</strong> Higher IPS ensures reliable tracking during rapid movements, essential for fast-paced gaming where quick swipes are common.
        </div>
      </div>
    </div>
  `,
  polling_rate: `
    <div class="filter-tooltip" id="pollingRateTooltip">
      <div class="tooltip-text">
        <div class="tooltip-item">
          <strong>What is Polling Rate?</strong> Polling rate, measured in Hz, is how often a mouse reports its position to the computer.
        </div>
        <div class="tooltip-item">
          <strong>Why Does It Matter?</strong> Higher polling rates provide smoother, more responsive tracking, critical for competitive gaming where precision and speed are key.
        </div>
      </div>
    </div>
  `,
  acceleration: `
    <div class="filter-tooltip" id="accelerationTooltip">
      <div class="tooltip-text">
        <div class="tooltip-item">
          <strong>What is Acceleration?</strong> Acceleration measures how quickly a mouse sensor can reach its maximum tracking speed, expressed in g-forces (g).
        </div>
        <div class="tooltip-item">
          <strong>Why Does It Matter?</strong> Higher acceleration ensures accurate tracking during fast movements, vital for dynamic gaming scenarios requiring rapid cursor shifts.
        </div>
      </div>
    </div>
  `,
  lift: `
    <div class="filter-tooltip" id="liftTooltip">
      <div class="tooltip-text">
        <div class="tooltip-item">
          <strong>What is Lift-Off Distance?</strong> Lift-off distance (LOD) is the height (in mm) at which a mouse’s sensor stops tracking when lifted from the surface.
        </div>
        <div class="tooltip-item">
          <strong>Why Does It Matter?</strong> A low LOD minimizes unwanted cursor movement during lifts, crucial for low-sensitivity gamers who frequently reposition their mouse.
        </div>
      </div>
    </div>
    `,
  lift_settings: `
      <div class="filter-tooltip" id="liftSettingsTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What are Lift Settings?</strong> Lift settings, often referred to as lift-off distance (LOD), determine the height at which a mouse’s sensor stops tracking when lifted off the surface. This is a critical feature in gaming mice, as it affects how the mouse behaves when you reposition it during gameplay.
          </div>
          <div class="tooltip-item">
            <strong>Why Do They Matter?</strong> The lift-off distance impacts precision and control. A lower LOD means the sensor stops tracking almost immediately upon lifting, reducing unwanted cursor movement—ideal for low-sensitivity gamers who frequently lift their mouse. A higher LOD allows tracking to continue slightly longer, which might suit high-sensitivity players or those with a lighter grip who don’t fully lift the mouse. Adjustable lift settings let you tailor this behavior to your playstyle and desk setup.
          </div>
          <div class="tooltip-item">
            <strong>Types of Lift Settings:</strong>
            <div class="tooltip-list">
              <div class="tooltip-list-item"><strong>Fixed Low (1-2 mm):</strong> The sensor ceases tracking at a very short distance from the surface (typically 1-2 mm). This minimizes cursor drift during lifts, offering maximum precision for gamers who need consistent control, such as in FPS games where micro-adjustments are key.</div>
              <div class="tooltip-list-item"><strong>Fixed High (3-5 mm):</strong> Tracking continues until the mouse is lifted higher (around 3-5 mm). This can be useful for players who don’t fully lift the mouse or prefer a more forgiving setting, though it may introduce slight cursor movement during repositioning.</div>
              <div class="tooltip-list-item"><strong>Adjustable:</strong> Many modern mice allow customization of the LOD via software or hardware switches (e.g., 1 mm to 3 mm or more). This flexibility accommodates different grip styles, mouse pads, and gaming habits, letting you fine-tune the sensor’s cutoff point for optimal performance.</div>
              <div class="tooltip-list-item"><strong>Surface-Tuned:</strong> Some advanced mice feature sensors that adapt the LOD based on the surface (e.g., cloth, hard, or hybrid mouse pads). This ensures consistent tracking behavior regardless of your desk setup, reducing the need for manual adjustments.</div>
            </div>
          </div>
        </div>
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>Choosing the Right Lift Settings:</strong> Your choice depends on your gaming style and habits. A <strong>low LOD</strong> enhances precision for frequent lifters, <strong>high LOD</strong> offers flexibility for minimal lifters, <strong>adjustable settings</strong> provide versatility across scenarios, and <strong>surface-tuned</strong> options ensure consistency on varied surfaces. Properly tuned lift settings can reduce errors, improve comfort, and elevate your in-game performance by aligning the mouse’s behavior with your natural movements.
          </div>
        </div>
      </div>
    `,
  motion_sync: `
      <div class="filter-tooltip" id="motionSyncTooltip">
        <div class="tooltip-text">
          Motion Sync synchronizes the mouse sensor's data output with the computer's USB polling rate for more consistent cursor movement. While it can reduce jitter, it might introduce minimal latency. Ideal for scenarios where consistent tracking is key.
        </div>
      </div>
    `,
  hardware_acceleration: `
      <div class="filter-tooltip" id="hardwareAccelerationTooltip">
        <div class="tooltip-text">
          Refers to built-in hardware acceleration, altering cursor speed based on mouse movement. Can disrupt precision, making it less ideal for gaming as it introduces unpredictability.
        </div>
      </div>
    `,
  smoothing: `
      <div class="filter-tooltip" id="smoothingTooltip">
        <div class="tooltip-text">
          Refers to built-in sensor smoothing or filtering that aims to provide more stable tracking but can introduce input lag. While smoothing can make movements appear less jittery, it may reduce precision for fast-paced gaming or other precise tasks.
        </div>
      </div>
    `,
  nvidia_reflex: `
      <div class="filter-tooltip" id="nvidiaReflexTooltip">
        <div class="tooltip-text">
          NVIDIA Reflex is a technology that reduces system latency in games, enhancing responsiveness. It's designed to align the game engine, rendering, and input for a smoother experience, making it ideal for competitive gaming where every millisecond counts.
        </div>
      </div>
    `,
  switch_type: `
      <div class="filter-tooltip" id="switchTypeTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Switch Type?</strong> The <strong>switch type</strong> determines how a mouse registers clicks, affecting speed, feel, and durability.
          </div>
          <div class="tooltip-item">
            <strong>Mechanical Switches:</strong>
            - Use <strong>physical metal contacts</strong> to register clicks.
            - Provide a <strong>tactile click</strong> with a distinct actuation point.
            - Require a small force to activate (~50g).
            - Can <strong>wear out over time</strong> but are rated for <strong>millions of clicks</strong>.
            - Brands: <strong>Omron, Kailh, Huano</strong>.
          </div>
          <div class="tooltip-item">
            <strong>Optical Switches:</strong>
            - Use <strong>light beams</strong> instead of metal contacts.
            - Have <strong>zero debounce delay</strong>, making them <strong>faster & more durable</strong>.
            - Do not wear out from mechanical friction.
            - Common in premium gaming mice for <strong>ultra-fast actuation</strong>.
            - Brands: <strong>Razer Optical, TTC Optical</strong>.
          </div>
          <div class="tooltip-item">
            <strong>Which Should You Choose?</strong>
            - <strong>Competitive FPS players</strong> prefer <strong>optical switches</strong> for speed.
            - <strong>Casual & MMO players</strong> might prefer <strong>mechanical switches</strong> for feel & cost.
          </div>
        </div>
      </div>
    `,
  switch: `
      <div class="filter-tooltip" id="switchTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What Are Switches?</strong> Switches are the <strong>mechanisms under each mouse button</strong> that register clicks. They play a crucial role in responsiveness, durability, and overall feel.
          </div>
          <div class="tooltip-item">
            <strong>How Do They Work?</strong> Inside each switch is a <strong>spring-loaded mechanism with contact points</strong> that close when pressed, completing the circuit and sending an input signal to your computer.
          </div>
          <div class="tooltip-item">
            <strong>Why Do Switches Matter?</strong>
            - <strong>Click Feel</strong> – Some switches are light and fast, others are more tactile and firm.
            - <strong>Durability</strong> – Most gaming switches are rated for <strong>tens of millions of clicks</strong>.
            - <strong>Latency & Speed</strong> – Some switches have <strong>zero debounce delay</strong>, crucial for fast-paced games.
          </div>
          <div class="tooltip-item">
            <strong>Popular Switch Brands:</strong>
            - <strong>Omron</strong> – Known for durability & tactile feel.
            - <strong>Kailh & Huano</strong> – Offer varying actuation forces & feedback styles.
            - <strong>Razer & TTC</strong> – Common in high-performance gaming mice, with optical options available.
          </div>
        </div>
      </div>
    `,
  hot_swappable: `
      <div class="filter-tooltip" id="hotSwappableTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What Are Hot-Swappable Switches?</strong> Hot-swappable switches allow you to easily replace the mouse’s click switches without soldering or extensive disassembly. This feature uses a socket system where switches can be pulled out and new ones pushed in, typically requiring minimal tools like a screwdriver to access the internals.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> Switches can wear out over time, causing issues like double-clicking or unresponsive buttons. Hot-swappable switches let you replace them, extending the mouse’s lifespan, saving costs, and reducing e-waste. It also enables customization of click feel or sound to suit your gaming or work preferences.
          </div>
          <div class="tooltip-item">
            <strong>Common Compatible Switches:</strong>
            <div class="tooltip-list">
              <div class="tooltip-list-item"><strong>Omron:</strong> Reliable and durable, known for consistent tactile feedback and high click ratings, a popular choice for replacements.</div>
              <div class="tooltip-list-item"><strong>Kailh:</strong> Offers smooth operation with varying actuation forces, allowing customization of click resistance and feedback.</div>
              <div class="tooltip-list-item"><strong>ROG Micro Switches:</strong> ASUS-designed switches optimized for gaming, providing quick response and low actuation force, compatible with specific ROG models.</div>
            </div>
          </div>  
          <div class="tooltip-item">
            <strong>Choosing a Hot-Swappable Mouse:</strong> Opt for this feature if you value longevity or want to tailor your mouse’s click experience. Check compatibility with switch types (e.g., Omron, Kailh), as not all mice support all switches. High-end models from brands like ASUS (ROG Keris) or Ironcat (HPC02MPro) often include this, balancing customization with performance. Ensure the mouse’s overall design meets your gaming needs beyond just switch replacement.
          </div>
        </div>
      </div>
      `,
  click_latency: `
      <div class="filter-tooltip" id="clickLatencyTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Click Latency?</strong> Click latency is the time it takes for a mouse to register and transmit a button click, measured in milliseconds.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> Lower click latency improves reaction time, crucial for gaming where fast, precise inputs can provide a competitive edge.
          </div>
        </div>
      </div>
    `,
  click_latency_list: `
      <div class="filter-tooltip" id="clickLatencyListTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Click Latency?</strong> Click latency is the time it takes for a mouse to register and transmit a button click, measured in milliseconds.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> Lower click latency improves reaction time, crucial for gaming where fast, precise inputs can provide a competitive edge.
          </div>
        </div>
      </div>
    `,
  click_force: `
      <div class="filter-tooltip" id="clickForceTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Click Force?</strong> Click force is the amount of force, measured in grams, required to actuate a mouse’s buttons.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> The click force affects the comfort and feel of clicks, with lighter forces enabling faster clicks and heavier forces providing tactile feedback.
          </div>
        </div>
      </div>
    `,
  side_buttons: `
      <div class="filter-tooltip" id="sideButtonsTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What are Side Buttons?</strong> Side buttons are programmable buttons located on the side of a mouse, typically accessed by the thumb.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> These buttons offer additional functions or shortcuts, enhancing efficiency in gaming, especially for genres like MMOs requiring multiple inputs.
          </div>
        </div>
      </div>
    `,
  middle_buttons: `
      <div class="filter-tooltip" id="middleButtonsTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What are Middle Buttons?</strong> Middle buttons are programmable buttons located near the scroll wheel on the top middle of a mouse.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> These buttons provide extra functionality for quick access to commands or macros, improving efficiency in gaming or productivity tasks.
          </div>
        </div>
      </div>
    `,
  tilt_scroll_wheel: `
      <div class="filter-tooltip" id="tiltScrollWheelTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is a Tilt Scroll Wheel?</strong> A tilt scroll wheel can tilt left or right to enable horizontal scrolling or additional programmable functions.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> It enhances navigation and control, useful for productivity tasks or gaming scenarios requiring quick access to extra inputs.
          </div>
        </div>
      </div>
    `,
  adjustable_scroll_wheel: `
      <div class="filter-tooltip" id="adjustableScrollWheelTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is an Adjustable Scroll Wheel?</strong> An adjustable scroll wheel allows users to customize the tension for a smooth or clicky scrolling feel.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> Tailoring the scroll wheel’s resistance enhances user comfort and precision, suiting different preferences for gaming or productivity.
          </div>
        </div>
      </div>
    `,
  programmable_buttons: `
      <div class="filter-tooltip" id="programmableButtonsTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What are Programmable Buttons?</strong> Programmable buttons are mouse buttons that can be customized to perform specific functions, macros, or shortcuts.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> They allow tailored control, streamlining complex inputs for gaming or workflows, especially in genres requiring multiple commands.
          </div>
        </div>
      </div>
    `,
  onboard_memory: `
      <div class="filter-tooltip" id="onboardMemoryTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Onboard Memory?</strong> Onboard memory allows a mouse to store settings like DPI, button configurations, and macros directly on the device.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> It ensures consistent settings across different computers without needing software, ideal for portability or tournament play.
          </div>
        </div>
      </div>
    `,
  profile_switching: `
      <div class="filter-tooltip" id="profileSwitchingTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Profile Switching?</strong> Profile switching enables a mouse to toggle between multiple custom configurations, such as DPI or button mappings.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> It allows quick adaptation to different games or tasks, enhancing versatility and efficiency without reconfiguring settings.
          </div>
        </div>
      </div>
    `,
  honeycomb_frame: `
      <div class="filter-tooltip" id="honeycombFrameTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is a Honeycomb Frame?</strong> A honeycomb frame is a mouse chassis with a perforated, hexagonal pattern to reduce weight.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> It makes the mouse lighter, improving maneuverability and reducing fatigue, ideal for fast-paced gaming with specific grip styles.
          </div>
        </div>
      </div>
    `,
  coating: `
      <div class="filter-tooltip" id="coatingTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>What is Coating?</strong> Coating is the surface finish or texture on a mouse, such as matte, glossy, or rubberized, affecting grip and feel.
          </div>
          <div class="tooltip-item">
            <strong>Why Does It Matter?</strong> The right coating enhances grip, comfort, and durability, ensuring secure handling during intense gaming sessions.
          </div>
        </div>
      </div>
    `,
  feet_material: `
      <div class="filter-tooltip" id="feetMaterialTooltip">
        <div class="tooltip-text">
          <div class="tooltip-item">
            <strong>Mouse Feet Material (Skates):</strong> These pads under your mouse significantly influence glide, performance, and durability.
          </div>
          <div class="tooltip-item">
            <strong>PTFE (Colored/Mixed):</strong> <em>Moderate friction coefficient</em> - Balances speed with a touch of added control, often seen in stock mouse setups for its versatility. The addition of dyes or other materials might slightly increase friction compared to virgin-grade, but it also enhances durability and offers color options for personalization.
          </div>
          <div class="tooltip-item">
            <strong>PTFE (Virgin-Grade):</strong> <em>Very low friction coefficient</em> - Pure PTFE provides minimal resistance, allowing for a seamless glide across your mousepad. This material is favored for its purity, which results in less wear over time, maintaining its glide properties longer than colored PTFE.
          </div>
          <div class="tooltip-item">
            <strong>Glass Skates (Glossy Aluminosilicate):</strong> <em>Lowest friction coefficient</em> - Offers an incredibly smooth glide, ideal for quick, precise movements in gaming. Their durability is unmatched, ensuring consistent performance over time, even under heavy use.
          </div>
          <div class="tooltip-item">
            <strong>Glass Skates (Matte Aluminosilicate):</strong> <em>Low friction coefficient</em> - Strikes a balance between speed and control, offering a tactile feedback not found in glossy finishes. The matte surface reduces the initial stickiness sometimes experienced with glossy skates, providing gamers with better control for micro-adjustments.
          </div>
          <div class="tooltip-item">
            <strong>UHMWPE:</strong> <em>Moderate to high friction coefficient</em> - Known for its durability, it provides a controlled glide, ideal for gamers who prefer precision.
          </div>
          <div class="tooltip-item">
            <strong>Ceramic:</strong> <em>Higher friction coefficient</em> - Durable and suited for hard surfaces, these skates offer control-focused glide characteristics.
          </div>
          <div class="tooltip-item">
            <strong>Sapphire:</strong> <em>Variable friction coefficient</em> - Luxury option with exceptional durability and glide, though performance can vary with surface treatment.
          </div>
          <div class="tooltip-item">
            <strong>Thickness and Shape:</strong> These aspects affect how your mouse interacts with the surface. Thicker skates can increase lift-off distance but may last longer, while shape influences glide smoothness.
          </div>
          <div class="tooltip-item">
            <strong>Installation and Maintenance:</strong> Proper installation involves cleaning, precise alignment of new skates, and sometimes heating for old skate removal. Regular maintenance ensures optimal glide performance.
          </div>
        </div>
      </div>
    `,
  silent_clicks: `
    <div class="filter-tooltip" id="silentClicksTooltip">
      <div class="tooltip-text">
        <div class="tooltip-item">
          <strong>What are Silent Clicks?</strong> Silent clicks refer to mouse buttons designed to produce minimal noise when pressed.
        </div>
        <div class="tooltip-item">
          <strong>Why Does It Matter?</strong> Quiet clicks reduce distractions, ideal for shared spaces or stealth usage, while maintaining responsive performance for gaming.
        </div>
      </div>
    </div>
  `,
  adjustable_weight: `
    <div class="filter-tooltip" id="adjustableWeightTooltip">
      <div class="tooltip-text">
        <div class="tooltip-item">
          <strong>What is Adjustable Weight?</strong> Adjustable weight allows users to modify a mouse’s weight by adding or removing modular weights.
        </div>
        <div class="tooltip-item">
          <strong>Why Does It Matter?</strong> Customizing weight tailors the mouse’s feel to user preference, balancing speed and control for different gaming styles.
        </div>
      </div>
    </div>
  `,
  weight: `
    <div class="filter-tooltip" id="weightTooltip">
      <div class="tooltip-text">
        <div class="tooltip-item">
          <strong>What is Weight?</strong> Weight refers to the mass of a gaming mouse, measured in grams, affecting its feel and maneuverability.
        </div>
        <div class="tooltip-item">
          <strong>Why Does It Matter?</strong> Lighter mice enable faster movements, ideal for competitive gaming, while heavier mice offer stability, suiting precise or controlled playstyles.
        </div>
      </div>
    </div>
    `,
};

// Function to retrieve tooltip HTML
export function getTooltipHtml(filterKey) {
  const snippet = TOOLTIPS[filterKey] || `<div class="tooltip-item">Missing tooltip for ${filterKey}</div>`;
  if (typeof Handlebars !== "undefined" && Handlebars.SafeString) {
    return new Handlebars.SafeString(snippet);
  }
  return snippet;
}

export function tooltipWithIcon(filterKey, maybeWrapper, options) {
  // determine wrapper flag:
  // – if called with named param (“wrapper=…”), read it from options.hash.wrapper
  // – else coerce the positional maybeWrapper to boolean
  const wrapper = options && options.hash && options.hash.wrapper !== undefined ? options.hash.wrapper : Boolean(maybeWrapper);

  const snippet = getTooltipHtml(filterKey);
  const camelCaseKey = filterKey.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
  const tooltipId = `${camelCaseKey}Tooltip`;

  const iconHtml = `
    <div class="filter-tooltip-icon-wrapper">
      <span class="filter-tooltip-icon" data-tooltip-id="${tooltipId}">?</span>
    </div>
  `;

  // only wrap the snippet when wrapper===true
  const specHtml = wrapper ? `<div class="filter-spec-tooltip"><div class="filter-spec-tooltip-scroller">${snippet}</div></div>` : snippet;

  const html = `
    ${iconHtml}
    ${specHtml}
  `;

  return typeof Handlebars !== "undefined" && Handlebars.SafeString ? new Handlebars.SafeString(html) : html;
}

export function hasTooltip(filterKey) {
  return TOOLTIPS.hasOwnProperty(filterKey);
}

// ============================================================================
// Export All Utility Helpers
// ============================================================================

const tooltipsMouse = {
  tooltipWithIcon,
  hasTooltip,
  getTooltipHtml,
  TOOLTIPS,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = tooltipsMouse;
}

if (typeof window !== "undefined") {
  window.tooltipsMouse = tooltipsMouse;
  window.dispatchEvent(new Event("tooltipsMouseReady"));
}
