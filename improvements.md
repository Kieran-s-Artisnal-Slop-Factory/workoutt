Do these tasks in order:

1. ~~If there are no exercises that exist, on the exercises page allow for an option to `load default exercises` which will seed the sample exercises that you would normally get from the onboarding (all of them)~~
2. ~~Add documentation to `/docs`~~ 
    1. Technical Documentation under `/docs/dev` include relevant code references, and mermaid diagrams where relevant, especially for complex sequences and relationships
        1. `/docs/dev/data-model.md` which contains everything you need ot know about the local data model client side
        2. `/docs/dev/sync.md` which contains everything you need to know as a dev about how the sync system works (with flowcharts and sequence diagrams), and the backend data model
        3. `/docs/dev/records-and-achievement.md` which explains all relevant information about how the PR tracking, weight tracking, and achievements systems work. Including how to add new achievements
        4. `/docs/dev/onboarding.md` documentation about how the onboarding system works, and how to add/edit default content (programs, workouts, exercises) that comes up when a user lets the system build a program for them
        5. `/docs/dev/theming.md` which contains information about modifying existing themes, and how the theme system works in general
        6. `/docs/dev/seeding.md` documentation about how the seeding system works, and how to make modifications to it
    2. User documentation under `/docs/user`, make the explanations plain and simple to follow for a non-technical audience while not ommiting important details. With all of these documents ensure they are also keeping in mind that some audience members don't know much about fitness, and will need more hand-holding around the conceptual aspects of what's being written
        1. `/docs/user/building-a-program.md` which contains a plain explanation of how to create a program, and what all the relevant peices are (how to create workouts, exercises, etc.). Everything you need to get started and understand programming for both people that know about fitness, and those who don't.
        2. `/docs/user/records-and-achievement.md` which contains information about weight tracking, PR's, and achievements
        3. `/docs/user/sync.md` which contains information about how to set up a sync server and the entire offline-first + sync architecture
3. ~~Add the option to repeat the onboarding~~
    1. Do not add duplicates of exercises, workouts or programs if they've already been added instead deferring to re-using the existing ones
