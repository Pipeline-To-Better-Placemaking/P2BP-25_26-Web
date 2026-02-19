# P2BP-25_26-Web
Website for the Fall '25 - Spring '26 Senior Design project.
## Setup
These are steps you will only have to do once. Some steps may need to be done other times, which will be noted.
### Server
#### Pre-requisites
1. Download [.NET 8.0](https://dotnet.microsoft.com/en-us/download/dotnet/8.0)
2. Firebase Credentials (in JSON format)
3. JWT Key
#### Steps
1. After cloning this project, go to `BetterPlacemaking.SERVER` folder of this repository in a terminal (you can use `cd` command in a terminal, or use `Open in Terminal` in Windows and equivalents for the File Managers in other OSes)
2. Run `dotnet restore BetterPlacemaking.csproj` (enclose `BetterPlacemaking.csproj` in quotes if needed)
  - If `dotnet` doesn't work, or uses an older version (you can verify by using `dotnet --version` in the terminal), even after installing v8.0, you may need to re-open your terminals

> **_NOTE:_**  This above step usually only needs to be done once, but if you are switching branches you may need to rerun the command to install the most up-to-date dependencies

3. Create a `firebase-service.json` file anywhere (preferably in the server folder, `BetterPlacemaking.SERVER`)
4. Populate the `firebase-service.json` with firebase credentials, which is in JSON format that contains fields like `private_key`, `project_id`, etc.
5. Keep a note of the filepath of this `firebase-service.json` file (either relative to the server folder `BetterPlacemaking.SERVER` or a global full path)
6. Create a `.env` file in the server folder (`BetterPlacemaking.SERVER`), and populate it like so:
  ```
  JWT__KEY=<Insert your JWT Key here>
  GOOGLE_APPLICATION_CREDENTIALS=<Insert the path of the firebase-service.json file>
  ```
> **_NOTE:_**  In my case, I kept the `firebase-service.json` file in the server folder, so I can just use `firebase-service.json`
### Client
#### Pre-requisites
1. Download [Node.js](https://nodejs.org/en/download)
#### Steps
1. Go to the client folder (`BetterPlacemaking.CLIENT`) in a terminal (you can use `cd` command in a terminal, or use `Open in Terminal` in Windows and equivalents for the File Managers in other OSes)
2. Run `npm install`, this installs the client dependencies
> **_NOTE:_**  This above step usually only needs to be done once, but if you are switching branches you may need to rerun the command to install the most up-to-date dependencies
3. Run `npm install -g @angular/cli`, this installs the Angular CLI tool
## Running the Project
These are steps you would do to run the project

> **_NOTE:_**  The server and client need to be run in separate terminals.

### Server
```
dotnet run --launch-profile https
```
- Runs at **https://localhost:7058** (HTTPS) and **http://localhost:5123** (HTTP)
- The `--launch-profile https` flag is **NECESSARY**. If omitted, the default profile will run on **http://localhost:5123** only, which the client doesn't use.

### Client
```
ng serve
```
- Runs at **http://localhost:4200**

> **_NOTE:_**  If the above step didn't work, try installing the Angular CLI tool again. Alternatively, you can use `npx ng serve` to run Angular CLI without installing it globally.