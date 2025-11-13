using Google.Cloud.Firestore;
using Microsoft.AspNetCore.Mvc;

namespace BetterPlacemaking.Services
{
    public class SampleService(FirestoreDb db) : ControllerBase
    {
        public string SampleServiceMethod()
        {
            string response = "pong";
            return response;
        }
    }
}