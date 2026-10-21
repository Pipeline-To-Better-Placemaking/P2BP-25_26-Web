import { useRef } from "react";
import Dropdown from "./Dropdown"


export function UploadDataPanel() {
    const floorPlanInputRef = useRef<HTMLInputElement>(null);
    const trackingDataInputRef = useRef<HTMLInputElement>(null);

    const dropdownOptions = [
        {label: "Meters (M)", value: "meters"},
        {label: "Millimeters, (mm)", value: "millimeters"}
    ]

    const handleSelect = (selected: { label: string; value: string }) => {
        console.log("Selected:", selected);
    };

    return (
        <div className = "flex-1 rounded-lg border border-neutral-200 bg-[#334155] p-6 relative">
            <h2 className = "text-2xl font-semibold text-white">
                Upload Floor Plan & Tracking Data
            </h2>

            <p className = "mt-2 text-xl text-white/80">
                Add floor plan and tracking data files to visualize the scanned environment.
            </p>

            <div className = "mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* floor plan input */}
                <div className = "rounded-lg border border-neutral-200 p-5">
                    <div className = "flex items-start gap-3">
                        <span className = "text-2xl text-white" aria-hidden="true">
                            
                        </span>

                        <div>
                            <h3 className = "font-semibold text-white/80">
                                Floor Plan File
                            </h3>
                            <p className="mt-1 text-sm text-white/70">
                                Select a floor plan image or file (e.g. PDF, PNG, JPG).
                            </p>
                        </div>
                    </div>

                    <div className = "mt-5 flex min-h-64 flex-col items-center justify-center rounded-lg border-2 border-dashed border-white px-4 py-8 text-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="lucide lucide-cloud-upload preview-icon">
                            <path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
                            <path d="m8 17 4-4 4 4"/>
                        </svg>

                        <p className = "mt-4 text-sm text-white/70">
                            Select a floor plan file
                        </p>

                        <p className = "mt-1 text-sm text-white/70">
                            DWG, RTV, etc...
                        </p>

                        <input
                            ref = {floorPlanInputRef}
                            type = "file"
                            accept = ".dwg,.rvt"
                            className = "hidden"
                            aria-label = "Choose floor plan file"
                        />
                        <button
                            type = "button"
                            onClick = {() => floorPlanInputRef.current?.click()}
                            className = "mt-4 rounded-md bg-[#5039f6] px-4 py-2 text-sm font-medium text-white hover:bg-[#5039f6]/50"
                        >
                            Choose File
                        </button>
                    </div>
                </div>

                <div className = "rounded-lg border border-neutral-200 p-5">
                    <div className = "flex items-start gap-3 relative">
                        <span className = "text-2xl text-white" aria-hidden="true">
                            
                        </span>

                        <div className="flex items-center">
                            <div>
                                <h3 className="font-semibold text-white/80">
                                    Tracking Data
                                </h3>
                                <p className = "mt-1 text-sm text-white/70">
                                    Select a tracking data file (.xyz, .obj...)
                                </p>
                            </div>
                            <div className = "absolute right-0">
                                <Dropdown 
                                    label = ""
                                    options = {dropdownOptions}
                                    onSelect = {handleSelect}
                                    placeholder = "Choose tracking unit"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="mt-5 flex min-h-64 flex-col items-center justify-center rounded-lg border-2 border-dashed border-white px-4 py-8 text-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="lucide lucide-cloud-upload preview-icon">
                            <path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
                            <path d="m8 17 4-4 4 4"/>
                        </svg>  

                        <p className="mt-4 text-sm font-medium text-white/70">
                            Select a tracking data file    
                        </p>   
                        <p className="mt-1 text-sm text-white/70">
                            XYZ, OBJ, PLY, etc...
                        </p>     

                        <input 
                            ref={trackingDataInputRef}
                            type="file"
                            accept=".xyz,.obj,.ply"
                            className="hidden"
                            aria-label="Choose tracking data file"
                        />       

                        <button
                            type="button"
                            onClick = {()=>trackingDataInputRef.current?.click()}
                            className="mt-4 rounded-md bg-[#5039f6] px-4 py-2 text-sm font-medium text-white hover:bg-[#5039f6]/50"
                        >
                            Choose File
                        </button>       
                    </div>
                </div>
            </div>
            <button
                type="button"
                className="mt-4 rounded-md bg-[#5039f6] px-4 py-2 text-sm font-medium text-white hover:bg-[#5039f6]/50 absolute bottom-5 right-5"
            >
                <div className="flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="lucide lucide-upload preview-icon">
                        <path d="M12 3v12"/>
                        <path d="m17 8-5-5-5 5"/>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    </svg>

                    <span className="font-medium ml-3">Upload</span>
                </div>
            </button>
        </div>
    )
}