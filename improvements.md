1. ~~Update the next workout card~~
    1. ~~have the option to `reschedule` which should give you a date picker to reschedule the workout~~
    2. ~~Have a `read more` button that pops up a modal with the workout title as the title, and in the modal the workout description, and sets that are part of the workout template as well as a preview of what you did last time (sets/reps wise)~~
2. Change the `This week` view to `workout schedule`
    1. It should show the current month, with the option to go to the previous month and next month
    2. Show all scheduled and completed workouts
    3. Allow people to move workouts to different days. If someone moves a workout to a past day pop up a modal
        1. The modal should be called `Moving workout to Past Date`
        2. Allow them to specify what time they completed the workout at
        3. Should give the option to `cancel`, `enter stats`, or `submit without stats`
            1. If `cancel` is selected, cancel the reschedule and move the workout back to it's original location
            2. If `enter stats` is selected take the user to a normal workout page for that workout to enter their sets and reps, but on save make sure to complete it on the day they specified
            3. If they hit `submit without stats` treat it as a workout without any sets or reps entered, and complete it on the day they specified
3. When seeding heavy usage data the programs page is empty
4. Have program records that are PR's per program, not just the global PR system
    1. Split the current records tab into a drop-down nav with the current records being called `All Time` and one called `By Program`
        1. `All Time` should be the current records page as it is
        2. `By Program` should have a select box at the top, and your records should show only for the time range that program ran for.
            1. Should default to the current program (if there is one)
            2. If there is no current program, pick the last completed program
            3. If there haven't been any programs completed just show `No prior program data available`
    2. The program records and PR's are different, you will likely need a separate joined table per program now, because if someones PR overall is 400lbs, but their PR for the program is 200lbs, it should show 200lbs, not 400lbs on the program record page
    3. You can just show the overall weight changes across each iteration of the program, not every measurement
        1. e.g. if you had 2 times you ran the program, for 4 weeks each. The first time you did the program you lost 3lbs, and the second time you lost 1lb. This should show up as 2 records with the time ranges they happened in that show -3lbs and -1lb
5. Plan out an acheivement system in a file called `acheivements.md`
    1. There will be 3 types of achievements
        1. Account-wide achievements
            1. These will trigger **once** (e.g. you setup your first program, you did 30 total workouts across all programs etc.)
        2. Per-exercise Achievements
            1. These will trigger **once per exercise**, and will largely be based on the measurement type (e.g. lift 1 ton of total volume, completed 1 hour total worth of this exercise)
        3. Per-program achievements
            1. This will trigger either 
                1. **once per program iteration** (e.g. You lifted 1 ton of total volume across all weight + rep exercises on this iteration of the program)
                2. **once per program for the lifetime of the program** (e.g. you ran this program twice)