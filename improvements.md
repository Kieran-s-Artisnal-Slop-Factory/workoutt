Do these tasks in order:

1. Give each pet an overview page or modal
    1. Allow users to see their pets previous forms by clicking on them
    2. have an indicator for when they hit each stage
    3. Have a cumulative total for how long they've been active
        1. For example someone initially unlocks a scorpion, uses them for a month as the active, switches to other pets for 5 months, then switches back for 3 months, it should be 4 months active, and 10 months old for that scorpion
        2. When opening an egg give the option for user to decide if they want to allow repeat pet or not (default to no repeats), disable this checkbox and enable repeats if user already has every type of pet
    4. Show an indicator for the 3 most popular body parts that are part of the exercises used to gain XP
        1. e.g. if you mostly train quads, chest and back, then most of the pets XP comes from those muscles, and the pet will say that it trains quads, chest and back
2. Document the pets system in:
    1. `docs/dev/pets.md` details about how the system operates with code references and diagrams
        1. explain both how to use the existing code, and how it works under the hood for
            1. Balancing
            2. XP gain
            2. Sprite generation
            3. Animation system
    1. `docs/user/pets.md` details about how pets gain XP, and a bit about the balancing of it
