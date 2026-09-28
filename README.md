# GitHubPageAsPaint

Paint a GitHub-style contribution grid with your real history and plan the weeks ahead.

## What it does

- loads the last 53 weeks of a user's GitHub contributions in a purple heatmap
- renders the calendar with `react-activity-calendar`
- lets you click future cells to cycle from 0 to 4 planned commits in GitHub green
- exports a `schedule.json` file describing the future drawing
- publishes random text commits for the selected dates with a personal access token

## Run locally

```bash
npm install
npm run serve
```

Then open `http://localhost:4173` and:

1. enter your GitHub username and target repository
2. load the grid
3. click the future cells until they reach the intensity you want
4. download `schedule.json`
5. publish the plan:

```bash
node ./scripts/publish-schedule.mjs --schedule ./schedule.json --username <username> --owner <owner> --repo <repo> --branch <branch> --token <token>
```

The publisher creates tiny text files inside `.github-page-as-paint/` and commits them at the scheduled dates. Before publishing, it checks how many contributions are already visible for the user on each scheduled day and only creates the missing commits needed to reach the requested count.
