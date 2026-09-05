import NextAuth from "next-auth"; 
import Credentials from "next-auth/providers/credentials"; 
import { connectToDatabase } from "@/lib/mongodb"; 
import { User } from "@/models/User"; 

export const { handlers, auth, signIn, signOut } = NextAuth({ 
  // 1. Enable core debug logs in the console
  debug: true, 

  providers: [ 
    Credentials({ 
      name: "Credentials", 
      credentials: { 
        email: { label: "Email", type: "email" }, 
        password: { label: "Password", type: "password" }, 
      }, 
      async authorize(credentials) { 
        console.log("[AUTH] Authorize callback triggered with email:", credentials?.email);

        if (!credentials?.email || !credentials?.password) { 
          console.warn("[AUTH] Missing email or password credentials.");
          return null; 
        } 

        try {
          console.log("[AUTH] Connecting to database...");
          await connectToDatabase(); 
          
          const emailClean = (credentials.email as string).toLowerCase();
          console.log("[AUTH] Searching for user:", emailClean);
          const user = await User.findOne({ email: emailClean }).select("+password"); 
          
          if (!user) {
            console.warn("[AUTH] No user found with email:", emailClean);
            return null; 
          }

          console.log("[AUTH] User found. Validating password...");
          const isPasswordValid = await user.comparePassword(credentials.password as string); 
          
          if (!isPasswordValid) {
            console.warn("[AUTH] Invalid password for user:", emailClean);
            return null; 
          }

          console.log("[AUTH] Authentication successful for user ID:", user._id.toString());
          return { 
            id: user._id.toString(), 
            name: user.name, 
            email: user.email, 
            image: user.image, 
            role: user.role, 
          }; 
        } catch (error) {
          // Captures connection issues, Mongoose errors, or password hashing failures
          console.error("[AUTH] Fatal error during authorize workflow:", error);
          return null;
        }
      }, 
    }), 
  ], 
  session: { 
    strategy: "jwt", 
  }, 
  callbacks: { 
    async jwt({ token, user }) { 
      if (user) { 
        console.log("[AUTH CALLBACK] Injecting user data into JWT token:", user.id);
        token.role = (user as any).role; 
        token.id = user.id; 
      } 
      return token; 
    }, 
    async session({ session, token }) { 
      if (session.user) { 
        console.log("[AUTH CALLBACK] Passing token data into Session:", token.id);
        (session.user as any).role = token.role; 
        (session.user as any).id = token.id; 
      } 
      return session; 
    }, 
  }, 
  pages: { 
    signIn: "/", 
  }, 
  secret: process.env.NEXTAUTH_SECRET, 
});
